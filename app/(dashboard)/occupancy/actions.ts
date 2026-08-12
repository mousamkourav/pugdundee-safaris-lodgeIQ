"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function n(v: FormDataEntryValue | null): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function back(lodge: string, month: string) {
  revalidatePath("/occupancy");
  redirect(`/occupancy?lodge=${lodge}&month=${month}`);
}

export async function addOccupancy(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const month = String(formData.get("month"));
  const supabase = await createClient();
  await supabase.from("occupancy_daily").upsert(
    {
      lodge_id,
      entry_date: String(formData.get("entry_date")),
      rooms_paid: n(formData.get("rooms_paid")),
      rooms_comp: n(formData.get("rooms_comp")),
      adults: n(formData.get("adults")),
      children_5_12: n(formData.get("children_5_12")),
      children_below_5: n(formData.get("children_below_5")),
      created_by: cu.user.id,
    },
    { onConflict: "lodge_id,entry_date" }
  );
  back(lodge_id, month);
}

export async function deleteOccupancy(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("occupancy_daily")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")), String(formData.get("month")));
}

export async function addExtraSale(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const month = String(formData.get("month"));
  const supabase = await createClient();
  await supabase.from("extra_sales").insert({
    lodge_id,
    entry_date: String(formData.get("entry_date")),
    line_item: String(formData.get("line_item")),
    amount: n(formData.get("amount")),
    remarks: String(formData.get("remarks") ?? "") || null,
    created_by: cu.user.id,
  });
  back(lodge_id, month);
}

export async function deleteExtraSale(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("extra_sales")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")), String(formData.get("month")));
}
