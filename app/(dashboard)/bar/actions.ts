"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function num(v: FormDataEntryValue | null): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function back(lodge: string) {
  revalidatePath("/bar");
  redirect(`/bar?lodge=${lodge}`);
}

export async function addBarItem(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const s = await createClient();
  await s.from("bar_items").insert({
    lodge_id,
    name: String(fd.get("name")),
    category: String(fd.get("category") ?? "") || null,
    unit: String(fd.get("unit") ?? "") || null,
    current_rate: num(fd.get("current_rate")),
    current_stock: num(fd.get("current_stock")),
    reorder_level: num(fd.get("reorder_level")),
  });
  back(lodge_id);
}

// Updating current_rate fires a DB trigger that logs rate history AND creates a notification.
export async function updateBarRate(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("bar_items")
    .update({ current_rate: num(fd.get("current_rate")) })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")));
}

export async function deleteBarItem(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("bar_items").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")));
}

export async function addBarMovement(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const item_id = String(fd.get("item_id"));
  const type = String(fd.get("type"));
  const qty = num(fd.get("qty"));
  const s = await createClient();

  await s.from("bar_stock_movements").insert({
    lodge_id,
    item_id,
    type,
    qty,
    rate: fd.get("rate") ? Number(fd.get("rate")) : null,
    date: String(fd.get("date")),
    notes: String(fd.get("notes") ?? "") || null,
  });

  // adjust current stock
  const { data: item } = await s
    .from("bar_items")
    .select("current_stock")
    .eq("id", item_id)
    .single();
  if (item) {
    const delta = type === "purchase" || type === "adjustment" ? qty : -qty;
    await s
      .from("bar_items")
      .update({ current_stock: Number(item.current_stock || 0) + delta })
      .eq("id", item_id);
  }
  back(lodge_id);
}
