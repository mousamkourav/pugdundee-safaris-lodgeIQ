"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runScan } from "@/lib/notify/scan";

export async function runChecks() {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");
  const res = await runScan();
  revalidatePath("/notifications");
  redirect(`/notifications?created=${res.created}&sent=${res.sent}`);
}

export async function markRead(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("notifications")
    .update({ status: "read" })
    .eq("id", String(fd.get("id")));
  revalidatePath("/notifications");
  redirect("/notifications");
}
