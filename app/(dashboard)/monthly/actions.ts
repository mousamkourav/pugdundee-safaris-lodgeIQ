"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/format";
import { parseMonthlyForm, computeDerived } from "@/lib/monthly";

function back(lodge: string, month: string) {
  revalidatePath("/monthly");
  redirect(`/monthly?lodge=${lodge}&month=${month}`);
}

async function loadRow(lodge: string, monthStart: string) {
  const s = await createClient();
  const { data } = await s
    .from("monthly_submissions")
    .select("*")
    .eq("lodge_id", lodge)
    .eq("month", monthStart)
    .maybeSingle();
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
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start } = monthRange(month);
  const admin = isAdmin(cu.profile?.role);

  const existing = await loadRow(lodge_id, start);
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
  if (submit) {
    payload.status = "submitted";
    payload.submitted_by = cu.user.id;
    payload.submitted_at = new Date().toISOString();
  } else if (!existing) {
    payload.status = "draft";
    payload.created_by = cu.user.id;
  } else if (admin) {
    payload.status = existing.status;
  } else {
    payload.status = "draft";
  }

  await s
    .from("monthly_submissions")
    .upsert(payload, { onConflict: "lodge_id,month" });
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
  const s = await createClient();
  await s
    .from("monthly_submissions")
    .update({ status: "draft", submitted_by: null, submitted_at: null })
    .eq("id", String(fd.get("id")));
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
