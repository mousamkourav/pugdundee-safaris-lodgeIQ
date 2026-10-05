"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type StatusInput =
  | { to: "booked"; amount: number; paymentRef: string; paymentDate: string; remark?: string }
  | { to: "lost"; reason: string; remark: string }
  | { to: "cancelled"; reason: string; remark: string; cancelCharge?: number | null; refund?: number | null }
  | { to: "open"; remark: string };

type Result = { ok?: boolean; error?: string };

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const clean = (v: string | undefined, max = 1000) => (v ?? "").trim().slice(0, max);

// The database trigger (sales_queries_guard_update) is the real referee:
// it allows only open->booked/lost, booked->cancelled, lost/cancelled->open,
// demands remarks and payment details, and writes the history row. These
// checks just give friendlier messages first.
export async function changeStatus(queryId: string, input: StatusInput): Promise<Result> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };

  let update: Record<string, unknown>;
  switch (input.to) {
    case "booked": {
      const ref = clean(input.paymentRef, 200);
      if (!(input.amount > 0)) return { error: "Enter the amount received." };
      if (!ref) return { error: "Enter the payment reference." };
      if (!isDate(input.paymentDate)) return { error: "Enter the payment date." };
      update = {
        status: "booked",
        booked_amount: Math.round(input.amount),
        payment_ref: ref,
        booked_at: `${input.paymentDate}T12:00:00+05:30`,
        status_remark: clean(input.remark) || null,
      };
      break;
    }
    case "lost": {
      if (!clean(input.reason)) return { error: "Choose a reason." };
      if (!clean(input.remark)) return { error: "A remark is required." };
      update = { status: "lost", lost_reason: clean(input.reason, 200), status_remark: clean(input.remark) };
      break;
    }
    case "cancelled": {
      if (!clean(input.reason)) return { error: "Choose a reason." };
      if (!clean(input.remark)) return { error: "A remark is required." };
      update = {
        status: "cancelled",
        lost_reason: clean(input.reason, 200), // the reason column is shared by lost and cancelled
        cancel_charge: input.cancelCharge ?? null,
        refund_amount: input.refund ?? null,
        status_remark: clean(input.remark),
      };
      break;
    }
    case "open": {
      if (!clean(input.remark)) return { error: "A remark is required to reopen." };
      update = { status: "open", lost_reason: null, status_remark: clean(input.remark) };
      break;
    }
    default:
      return { error: "Unknown status." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.from("sales_queries").update(update).eq("id", queryId).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "This query is not assigned to you, so its status cannot be changed." };

  revalidatePath(`/sales/queries/${queryId}`);
  revalidatePath("/sales", "layout");
  return { ok: true };
}

export async function reassignQuery(queryId: string, memberId: string, remark: string): Promise<Result> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role)) return { error: "Only admins can reassign queries." };
  if (!memberId) return { error: "Choose a member." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_queries")
    .update({ assigned_to: memberId, status_remark: clean(remark) || null })
    .eq("id", queryId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Query not found." };

  revalidatePath(`/sales/queries/${queryId}`);
  revalidatePath("/sales", "layout");
  return { ok: true };
}
