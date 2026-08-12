"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function back(lodge: string) {
  revalidatePath("/travel-agents");
  redirect(`/travel-agents?lodge=${lodge}`);
}

export async function addAgent(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const s = await createClient();
  await s.from("travel_agents").insert({
    lodge_id,
    agency: String(fd.get("agency")),
    contact: String(fd.get("contact") ?? "") || null,
    entry_date: String(fd.get("entry_date") || "") || null,
  });
  back(lodge_id);
}

export async function deleteAgent(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("travel_agents").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")));
}
