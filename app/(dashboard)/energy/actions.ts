"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function back(lodge: string, month: string) {
  revalidatePath("/energy");
  redirect(`/energy?lodge=${lodge}&month=${month}`);
}

export async function addEnergy(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const month = String(formData.get("month"));
  const opening = num(formData.get("opening"));
  const closing = num(formData.get("closing"));
  const net =
    opening !== null && closing !== null ? closing - opening : null;

  const supabase = await createClient();
  await supabase.from("energy_readings").insert({
    lodge_id,
    entry_date: String(formData.get("entry_date")),
    asset: String(formData.get("asset")),
    opening,
    closing,
    net_usage: net,
    fuel_litres: num(formData.get("fuel_litres")),
    cost_rs: num(formData.get("cost_rs")),
    rate_per_ltr: num(formData.get("rate_per_ltr")),
    notes: String(formData.get("notes") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function deleteEnergy(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("energy_readings")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")), String(formData.get("month")));
}
