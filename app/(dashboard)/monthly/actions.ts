"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/format";
import {
  parseMonthlyForm,
  computeDerived,
  canEditReportData,
  reportOwner,
} from "@/lib/monthly";

function back(lodge: string, month: string) {
  revalidatePath("/monthly");
  redirect(`/monthly?lodge=${lodge}&month=${month}`);
}

async function loadRow(lodge: string, monthStart: string) {
  const s = await createClient();
  const { data, error } = await s
    .from("monthly_submissions")
    .select("*")
    .eq("lodge_id", lodge)
    .eq("month", monthStart)
    .maybeSingle();
  // Never fall through to "no row" on a read error: that would save a merge
  // onto {} and mark it as a brand-new report.
  if (error) throw new Error(`Could not load the report: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Deep-merge submitted values onto the existing stored data so a save can NEVER
// wipe fields the form didn't include. Arrays are replaced wholesale (they are
// edited as complete blocks); plain objects merge key-by-key.
function deepMerge(base: any, patch: any): any {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === "object") {
    const out: Record<string, any> =
      base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(out[k], patch[k]);
    }
    return out;
  }
  return patch;
}

async function saveInternal(fd: FormData, submit: boolean) {
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start } = monthRange(month);

  // The form posts the lodge+month its data was loaded for. If they differ from
  // the target, the values on screen belong to another report - refuse to save
  // them here (this is how Waghoba Sept 2026 got August's data and was locked).
  const origin = fd.get("form_origin");
  if (origin !== null && String(origin) !== `${lodge_id}|${month}`) {
    back(lodge_id, month);
    return;
  }

  // Auth and the existing row are independent: fetch both at once.
  const [cu, existing] = await Promise.all([
    getCurrentUser(),
    loadRow(lodge_id, start),
  ]);
  if (!cu?.user) throw new Error("Not authorized");
  const admin = isAdmin(cu.profile?.role);

  // Only the report's creator may edit its data (see canEditReportData). Admins
  // keep reopen / approve / delete, which are separate actions.
  if (!canEditReportData(existing, cu.user.id, admin)) {
    back(lodge_id, month);
    return;
  }
  if (existing && existing.status === "submitted" && !admin) {
    back(lodge_id, month);
    return;
  }

  // Merge submitted fields onto whatever is already stored, THEN recompute
  // totals from the merged result. This preserves any field not present in the
  // submitted form and prevents blank overwrites.
  const submitted = parseMonthlyForm(fd);
  const existingData =
    (existing?.data as Record<string, unknown> | undefined) ?? {};
  const merged = deepMerge(existingData, submitted);
  const data = computeDerived(merged);

  const s = await createClient();
  const payload: Record<string, unknown> = { lodge_id, month: start, data };
  // New report, or an older row with no created_by: record who saved it, so
  // ownership is explicit from here on. Only reached when this user may edit
  // it (its submitted_by owner, or an unowned row).
  if (!existing || !existing.created_by) payload.created_by = cu.user.id;
  if (submit) {
    payload.status = "submitted";
    payload.submitted_by = cu.user.id;
    payload.submitted_at = new Date().toISOString();
  } else if (!existing) {
    payload.status = "draft";
  } else if (admin) {
    payload.status = existing.status;
  } else {
    payload.status = "draft";
  }

  const { error } = await s
    .from("monthly_submissions")
    .upsert(payload, { onConflict: "lodge_id,month" });
  // Surface failures instead of redirecting as if the save worked.
  if (error) throw new Error(`Could not save the report: ${error.message}`);
  back(lodge_id, month);
}

export async function saveDraft(fd: FormData) {
  await saveInternal(fd, false);
}
export async function submitReport(fd: FormData) {
  await saveInternal(fd, true);
}

export async function reopenReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");
  const id = String(fd.get("id"));
  const s = await createClient();
  // Clearing submitted_by must not erase who owns the report: older rows may
  // record their creator only there, so carry it into created_by first.
  const { data: cur } = await s
    .from("monthly_submissions")
    .select("created_by, submitted_by")
    .eq("id", id)
    .maybeSingle();
  const owner = reportOwner(cur as { created_by?: unknown; submitted_by?: unknown } | null);
  const { error } = await s
    .from("monthly_submissions")
    .update({
      status: "draft",
      submitted_by: null,
      submitted_at: null,
      ...(owner ? { created_by: owner } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(`Could not reopen the report: ${error.message}`);
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function deleteReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role))
    throw new Error("Not authorized");
  const s = await createClient();
  await s.from("monthly_submissions").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
