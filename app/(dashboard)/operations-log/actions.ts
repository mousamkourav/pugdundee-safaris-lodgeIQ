"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { monthRange } from "@/lib/format";

function n(v: FormDataEntryValue | null): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function has(fd: FormData, k: string): boolean {
  return fd.get(k) === "on" || fd.get(k) === "true";
}
function back(lodge: string, month: string) {
  revalidatePath("/operations-log");
  redirect(`/operations-log?lodge=${lodge}&month=${month}`);
}

export async function addSafari(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("safari_usage").insert({
    lodge_id,
    entry_date: String(fd.get("entry_date")),
    our_turn: n(fd.get("our_turn")),
    against_waiting: n(fd.get("against_waiting")),
    union_gypsy: n(fd.get("union_gypsy")),
    total_safaris: n(fd.get("total_safaris")),
    full_day: n(fd.get("full_day")),
    outside_pickup_drop: n(fd.get("outside_pickup_drop")),
    isuzu_pickup_drop: n(fd.get("isuzu_pickup_drop")),
    remarks: String(fd.get("remarks") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function addTicket(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("ticket_usage").insert({
    lodge_id,
    entry_date: String(fd.get("entry_date")),
    delhi_used: n(fd.get("delhi_used")),
    gate_taken: n(fd.get("gate_taken")),
    boat: n(fd.get("boat")),
    total_used: n(fd.get("total_used")),
    by_guest: n(fd.get("by_guest")),
    delhi_unused: n(fd.get("delhi_unused")),
    guide_fees_regular: n(fd.get("guide_fees_regular")),
    guide_fees_fullday: n(fd.get("guide_fees_fullday")),
    park_bans: String(fd.get("park_bans") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function addGuestExp(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("guest_experiences").insert({
    lodge_id,
    entry_date: String(fd.get("entry_date")),
    experience_dinners: has(fd, "experience_dinners"),
    presentations: has(fd, "presentations"),
    private_dinners: has(fd, "private_dinners"),
    notes: String(fd.get("notes") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function saveAccounts(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start } = monthRange(month);
  const s = await createClient();
  await s.from("accounts_status").upsert(
    {
      lodge_id,
      month: start,
      sales_entered: has(fd, "sales_entered"),
      petty_cash_entered: has(fd, "petty_cash_entered"),
      expenses_entered: has(fd, "expenses_entered"),
      remarks: String(fd.get("remarks") ?? "") || null,
    },
    { onConflict: "lodge_id,month" }
  );
  back(lodge_id, month);
}

export async function addSimpleStock(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start } = monthRange(month);
  const s = await createClient();
  await s.from("simple_stock").insert({
    lodge_id,
    month: start,
    item: String(fd.get("item")),
    opening: n(fd.get("opening")),
    used: n(fd.get("used")),
    closing: n(fd.get("closing")),
  });
  back(lodge_id, month);
}

export async function deleteRow(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const table = String(fd.get("table"));
  const allowed = ["safari_usage", "ticket_usage", "guest_experiences", "simple_stock"];
  if (!allowed.includes(table)) throw new Error("Bad table");
  const s = await createClient();
  await s.from(table).delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
