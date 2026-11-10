"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/format";

// Append ?notice=... (or &notice=...) so /monthly can confirm what happened.
// Only /monthly shows these banners; other pages ignore the extra param.
function withNotice(url: string, notice: string): string {
  return url + (url.includes("?") ? "&" : "?") + `notice=${notice}`;
}

// Manager: request edit access on a submitted (locked) report.
export async function requestEdit(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge = String(fd.get("lodge_id") ?? "");
  const month = String(fd.get("month") ?? "");
  const { start } = monthRange(month);
  const s = await createClient();

  // Avoid duplicate pending requests for the same lodge+month.
  const { data: existing } = await s
    .from("edit_requests")
    .select("id")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .eq("status", "pending")
    .maybeSingle();

  if (!existing) {
    await s.from("edit_requests").insert({
      lodge_id: lodge,
      month: start,
      requested_by: cu.user.id,
      status: "pending",
    });

    // Notify admins via the notifications table.
    const who = cu.profile?.full_name ?? cu.user.email ?? "A manager";
    await s.from("notifications").insert({
      lodge_id: lodge,
      type: "edit_request",
      severity: "warning",
      title: "Edit access requested",
      body: `${who} requested edit access for the ${month} report.`,
      status: "pending",
      channels: ["app"],
      extra: { month: start, month_label: month },
    });
  }

  revalidatePath("/monthly");
  redirect(`/monthly?lodge=${lodge}&month=${month}&notice=requested`);
}

// Admin: approve an edit request -> report unlocks for the manager.
export async function approveEdit(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");
  const lodge = String(fd.get("lodge_id") ?? "");
  const month = String(fd.get("month") ?? "");
  const back = String(fd.get("back") ?? "/notifications");
  const { start } = monthRange(month);
  const s = await createClient();

  // Unlock the report first: if that fails, the request stays pending instead
  // of showing "approved" on a report that is still locked.
  const { error: unlockErr } = await s
    .from("monthly_submissions")
    .update({ status: "draft" })
    .eq("lodge_id", lodge)
    .eq("month", start);
  const { error: reqErr } = unlockErr
    ? { error: unlockErr }
    : await s
        .from("edit_requests")
        .update({ status: "approved", decided_by: cu.user.id, decided_at: new Date().toISOString() })
        .eq("lodge_id", lodge)
        .eq("month", start)
        .eq("status", "pending");

  revalidatePath("/monthly");
  revalidatePath("/notifications");
  redirect(withNotice(back, unlockErr || reqErr ? "error" : "reopened"));
}

// Admin: decline an edit request.
export async function declineEdit(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");
  const lodge = String(fd.get("lodge_id") ?? "");
  const month = String(fd.get("month") ?? "");
  const back = String(fd.get("back") ?? "/notifications");
  const { start } = monthRange(month);
  const s = await createClient();

  const { error } = await s
    .from("edit_requests")
    .update({ status: "declined", decided_by: cu.user.id, decided_at: new Date().toISOString() })
    .eq("lodge_id", lodge)
    .eq("month", start)
    .eq("status", "pending");

  revalidatePath("/monthly");
  revalidatePath("/notifications");
  redirect(withNotice(back, error ? "error" : "declined"));
}
