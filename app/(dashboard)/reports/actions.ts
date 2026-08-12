"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { monthRange } from "@/lib/format";

function back(lodge: string, month: string) {
  revalidatePath("/reports");
  redirect(`/reports?lodge=${lodge}&month=${month}`);
}

export async function generateReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start } = monthRange(month);
  const s = await createClient();
  await s.from("monthly_reports").upsert(
    { lodge_id, month: start, status: "draft" },
    { onConflict: "lodge_id,month" }
  );
  back(lodge_id, month);
}

export async function submitReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("monthly_reports")
    .update({
      status: "submitted",
      submitted_by: cu.user.id,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function reviewReport(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("monthly_reports")
    .update({ status: "reviewed", reviewed_by: cu.user.id })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
