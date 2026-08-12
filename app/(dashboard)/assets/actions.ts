"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function back(lodge: string) {
  revalidatePath("/assets");
  redirect(`/assets?lodge=${lodge}`);
}

export async function addAsset(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const interval = formData.get("service_interval_months");
  const supabase = await createClient();
  await supabase.from("assets").insert({
    lodge_id,
    name: String(formData.get("name")),
    category: String(formData.get("category") ?? "") || null,
    criticality: String(formData.get("criticality") ?? "normal"),
    service_interval_months: interval ? Number(interval) : null,
  });
  back(lodge_id);
}

export async function deleteAsset(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase.from("assets").delete().eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")));
}

export async function recordService(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const supabase = await createClient();
  // next_due is auto-filled by a DB trigger from the asset's service interval.
  await supabase.from("service_records").insert({
    lodge_id,
    asset_id: String(formData.get("asset_id")),
    service_date: String(formData.get("service_date")),
    notes: String(formData.get("notes") ?? "") || null,
    created_by: cu.user.id,
  });
  back(lodge_id);
}

export async function deleteService(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("service_records")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")));
}
