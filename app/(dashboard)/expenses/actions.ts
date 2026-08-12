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
  revalidatePath("/expenses");
  redirect(`/expenses?lodge=${lodge}&month=${month}`);
}

export async function addExpense(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(formData.get("lodge_id"));
  const month = String(formData.get("month"));
  const supabase = await createClient();
  await supabase.from("expenses").insert({
    lodge_id,
    entry_date: String(formData.get("entry_date")),
    category: String(formData.get("category")),
    line_item: String(formData.get("line_item")),
    amount: n(formData.get("amount")),
    remarks: String(formData.get("remarks") ?? "") || null,
    created_by: cu.user.id,
  });
  back(lodge_id, month);
}

export async function deleteExpense(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const supabase = await createClient();
  await supabase
    .from("expenses")
    .delete()
    .eq("id", String(formData.get("id")));
  back(String(formData.get("lodge_id")), String(formData.get("month")));
}
