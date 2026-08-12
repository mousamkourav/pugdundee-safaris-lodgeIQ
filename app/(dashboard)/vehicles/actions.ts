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
  revalidatePath("/vehicles");
  redirect(`/vehicles?lodge=${lodge}&month=${month}`);
}

export async function addVehicle(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const month = String(formData.get("month"));
  const supabase = await createClient();
  await supabase.from("vehicles").insert({
    lodge_id,
    vehicle_no: String(formData.get("vehicle_no")),
    label: String(formData.get("label") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function addVehicleLog(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const month = String(formData.get("month"));
  const supabase = await createClient();
  await supabase.from("vehicle_logs").insert({
    lodge_id,
    vehicle_id: String(formData.get("vehicle_id")),
    entry_date: String(formData.get("entry_date")),
    opening_km: num(formData.get("opening_km")),
    closing_km: num(formData.get("closing_km")),
    fuel_ltr: num(formData.get("fuel_ltr")),
    cost_rs: num(formData.get("cost_rs")),
    rate: num(formData.get("rate")),
  });
  back(lodge_id, month);
}

export async function deleteVehicleLog(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("vehicle_logs")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")), String(formData.get("month")));
}
