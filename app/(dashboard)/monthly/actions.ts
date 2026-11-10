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

// Every save ends here with a notice code the page turns into a banner
// (saved / submitted / why it was NOT saved). Before this, refused saves
// redirected silently and looked exactly like a successful save.
function back(lodge: string, month: string, notice?: string) {
  revalidatePath("/monthly");
  const n = notice ? `&notice=${notice}` : "";
  redirect(`/monthly?lodge=${lodge}&month=${month}${n}`);
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
  // redirect() works by throwing, so it must never run inside the try below.
  const notice = await trySave(fd, lodge_id, month, submit);
  back(lodge_id, month, notice);
}

// Returns the notice code for the banner. Never throws for an expected
// failure: throwing would replace the form with an error page and the
// manager would lose everything typed. A redirect keeps the form on screen.
async function trySave(
  fd: FormData,
  lodge_id: string,
  month: string,
  submit: boolean
): Promise<string> {
  const { start } = monthRange(month);

  // The form posts the lodge+month its data was loaded for. If they differ from
  // the target, the values on screen belong to another report - refuse to save
  // them here (this is how Waghoba Sept 2026 got August's data and was locked).
  const origin = fd.get("form_origin");
  if (origin !== null && String(origin) !== `${lodge_id}|${month}`) return "stale";

  try {
    // Auth and the existing row are independent: fetch both at once.
    const [cu, existing] = await Promise.all([
      getCurrentUser(),
      loadRow(lodge_id, start),
    ]);
    if (!cu?.user) return "error";
    const admin = isAdmin(cu.profile?.role);

    // Only the report's creator may edit its data (see canEditReportData). Admins
    // keep reopen / approve / delete, which are separate actions.
    if (!canEditReportData(existing, cu.user.id, admin)) return "not_owner";
    if (existing && existing.status === "submitted" && !admin) return "locked";

    // Merge submitted fields onto whatever is already stored, THEN recompute
    // totals from the merged result. Fields not on the form are preserved.
    const submitted = parseMonthlyForm(fd);
    const existingData =
      (existing?.data as Record<string, unknown> | undefined) ?? {};
    const merged = deepMerge(existingData, submitted);
    const data = computeDerived(merged);

    const s = await createClient();
    const payload: Record<string, unknown> = { lodge_id, month: start, data };
    // New report, or an older row with no created_by: record who saved it, so
    // ownership is explicit from here on.
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
    if (error) {
      console.error("monthly save failed", lodge_id, month, error.message);
      return "error";
    }
    return submit ? "submitted" : "saved";
  } catch (e) {
    console.error("monthly save failed", lodge_id, month, e);
    return "error";
  }
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
  back(String(fd.get("lodge_id")), String(fd.get("month")), error ? "error" : "reopened");
}

export async function deleteReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role))
    throw new Error("Not authorized");
  const s = await createClient();
  const { error } = await s
    .from("monthly_submissions")
    .delete()
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")), error ? "error" : "deleted");
}
