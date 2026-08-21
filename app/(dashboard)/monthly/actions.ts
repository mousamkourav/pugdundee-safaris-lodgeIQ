"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/format";
import { parseMonthlyForm } from "@/lib/monthly";

function back(lodge: string, month: string) {
  revalidatePath("/monthly");
  redirect(`/monthly?lodge=${lodge}&month=${month}`);
}

// Load existing row + whether the current user may edit it.
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

async function saveInternal(fd: FormData, submit: boolean) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start } = monthRange(month);
  const admin = isAdmin(cu.profile?.role);

  const existing = await loadRow(lodge_id, start);
  // Lock: once submitted, only an admin may change it.
  if (existing && existing.status === "submitted" && !admin) {
    // Manager cannot edit a submitted report.
    back(lodge_id, month);
  }

  const data = parseMonthlyForm(fd);
  const s = await createClient();

  const payload: Record<string, unknown> = {
    lodge_id,
    month: start,
    data,
  };
  if (submit) {
    payload.status = "submitted";
    payload.submitted_by = cu.user.id;
    payload.submitted_at = new Date().toISOString();
  } else if (!existing) {
    payload.status = "draft";
    payload.created_by = cu.user.id;
  } else if (admin) {
    // admin editing keeps existing status unless they explicitly submit
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

// Admin-only: reopen a submitted report back to draft (so a manager can fix it).
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

// Super-admin only (enforced also by RLS): delete a report.
export async function deleteReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || cu.profile?.role !== "super_admin")
    throw new Error("Not authorized");
  const s = await createClient();
  await s.from("monthly_submissions").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
