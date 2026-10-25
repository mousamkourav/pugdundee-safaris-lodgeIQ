"use server";

import { safe } from "@/lib/sales/safe";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isInactive, isSalesUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type StatusInput =
  | { to: "booked"; amount: number; paymentRef: string; paymentDate: string; remark?: string }
  | { to: "lost"; reason: string; remark: string }
  | { to: "cancelled"; reason: string; remark: string; cancelCharge?: number | null; refund?: number | null }
  | { to: "open"; remark: string }
  | { to: "quoted"; remark?: string };

type Result = { ok?: boolean; error?: string };

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const clean = (v: string | undefined, max = 1000) => (v ?? "").trim().slice(0, max);

// The database trigger (sales_queries_guard_update) is the real referee:
// it allows only draft->open, open->quoted/booked/lost, quoted->booked/lost/open,
// booked->cancelled, lost/cancelled->open,
// demands remarks and payment details, and writes the history row. These
// checks just give friendlier messages first.
async function changeStatusUnsafe(queryId: string, input: StatusInput): Promise<Result> {
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
    case "quoted": {
      // The quote has been sent to the guest. The database stamps quoted_at.
      update = { status: "quoted", status_remark: clean(input.remark) || null };
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
  // a deleted query stays as it was deleted
  const { data, error } = await supabase.from("sales_queries").update(update).eq("id", queryId).is("deleted_at", null).select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "This query is not assigned to you, so its status cannot be changed." };

  revalidatePath(`/sales/queries/${queryId}`);
  revalidatePath("/sales", "layout");
  return { ok: true };
}

async function reassignQueryUnsafe(queryId: string, memberId: string, remark: string): Promise<Result> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return { error: "Only admins can reassign queries." };
  if (!memberId) return { error: "Choose a member." };
  // only to someone who can work in Sales and is not deactivated (profiles RLS may
  // hide other users, so this read uses the service role, server-side only)
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: target } = await createAdminClient().from("profiles").select("role, status").eq("id", memberId).maybeSingle();
  const t = target as { role: string | null; status: string | null } | null;
  if (!t || !isSalesUser(t.role) || isInactive(t)) return { error: "Choose an active Sales member." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_queries")
    .update({ assigned_to: memberId, status_remark: clean(remark) || null })
    .eq("id", queryId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Query not found." };

  revalidatePath(`/sales/queries/${queryId}`);
  revalidatePath("/sales", "layout");
  return { ok: true };
}

async function deleteDraftUnsafe(queryId: string): Promise<Result> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };
  const supabase = await createClient();
  // RLS lets members delete only their own drafts; admins can delete any query.
  const { data, error } = await supabase.from("sales_queries").delete().eq("id", queryId).eq("status", "draft").select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "Only drafts can be deleted, and only by their owner." };
  revalidatePath("/sales", "layout");
  return { ok: true };
}

// Public actions: same as above, but failures come back as { error } instead of crashing.
export async function changeStatus(queryId: string, input: StatusInput): Promise<Result> {
  return safe("changeStatus", () => changeStatusUnsafe(queryId, input));
}

export async function reassignQuery(queryId: string, memberId: string, remark: string): Promise<Result> {
  return safe("reassignQuery", () => reassignQueryUnsafe(queryId, memberId, remark));
}
export async function deleteDraft(queryId: string): Promise<Result> {
  return safe("deleteDraft", () => deleteDraftUnsafe(queryId));
}

// ---------------------------------------------------------------- flight booking details

export async function saveFlightBooking(
  queryId: string,
  itemId: string,
  input: { airline: string; flight_no: string; depart_time: string; arrive_time: string; pnr: string; ticket_no: string; status: string; notes: string }
): Promise<Result> {
  return safe("saveFlightBooking", async () => {
    const cu = await getCurrentUser();
    if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };
    // the user's own client: RLS decides whether they may see this query
    const supabase = await createClient();
    const { data: q } = await supabase.from("sales_queries").select("id, assigned_to").eq("id", queryId).is("deleted_at", null).maybeSingle();
    if (!q) return { error: "Query not found, or it is not assigned to you." };
    if (!isSalesAdmin(cu.profile?.role) && (q as { assigned_to: string | null }).assigned_to !== cu.user.id) return { error: "Only the member this query is assigned to can change its flights." };
    const { data: v } = await supabase.from("sales_itinerary_versions").select("plan").eq("query_id", queryId).order("version_no", { ascending: false }).limit(1).maybeSingle();
    const days = ((v as { plan?: { days?: { items?: { id?: string; type?: string }[] }[] } } | null)?.plan?.days ?? []) as { items?: { id?: string; type?: string }[] }[];
    if (!days.some((d) => (d.items ?? []).some((it) => it.id === itemId && it.type === "flight"))) return { error: "This flight is not in the latest version of the itinerary." };

    const time = (t: string) => (/^\d{1,2}:\d{2}$/.test(t.trim()) ? t.trim().padStart(5, "0") : null);
    if (input.depart_time && !time(input.depart_time)) return { error: "Take-off time: use hh:mm." };
    if (input.arrive_time && !time(input.arrive_time)) return { error: "Landing time: use hh:mm." };
    const status = ["planned", "on_hold", "confirmed", "cancelled"].includes(input.status) ? input.status : "planned";
    if (status === "confirmed" && !clean(input.pnr)) return { error: "A confirmed flight needs its PNR." };

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { error } = await createAdminClient()
      .from("sales_flight_bookings")
      .upsert(
        {
          query_id: queryId,
          item_id: itemId.slice(0, 80),
          airline: clean(input.airline, 60) || null,
          flight_no: clean(input.flight_no, 20) || null,
          depart_time: input.depart_time ? time(input.depart_time) : null,
          arrive_time: input.arrive_time ? time(input.arrive_time) : null,
          pnr: clean(input.pnr, 20).toUpperCase() || null,
          ticket_no: clean(input.ticket_no, 40) || null,
          status,
          notes: clean(input.notes, 500) || null,
          updated_by: cu.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "query_id,item_id" }
      );
    if (error) return { error: /does not exist|schema cache/i.test(error.message) ? "Run sales_v3_flights_parks.sql in Supabase first." : error.message };
    revalidatePath(`/sales/queries/${queryId}`);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- deleting a query

// Soft delete: the query is hidden from every list and its client links stop working,
// but its versions and history are kept. Sales admins and the super roles only.
export async function deleteQuery(queryId: string, reason: string): Promise<Result> {
  return safe("deleteQuery", async () => {
    const cu = await getCurrentUser();
    if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return { error: "Only Sales admins can delete a query." };
    const supabase = await createClient();
    const { data: q } = await supabase.from("sales_queries").select("id, query_no, guest_name, status, total_amount").eq("id", queryId).is("deleted_at", null).maybeSingle();
    if (!q) return { error: "Query not found, or already deleted." };
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient();
    const when = new Date().toISOString();
    const { error } = await db.from("sales_queries").update({ deleted_at: when, deleted_by: cu.user.id }).eq("id", queryId);
    if (error) return { error: /deleted_at|schema cache/i.test(error.message) ? "Run sales_v4_queries.sql in Supabase first." : error.message };
    // who, when and why (the audit log is for the record; a failure here does not undo the delete)
    const row = q as { query_no: string; guest_name: string; status: string; total_amount: number | null };
    await db
      .from("audit_log")
      .insert({ actor: cu.user.id, action: "sales_query_deleted", table_name: "sales_queries", record_id: queryId, diff: { query_no: row.query_no, guest_name: row.guest_name, status: row.status, total: row.total_amount, reason: clean(reason, 300) || null, deleted_at: when } })
      .then(() => undefined, () => undefined);
    revalidatePath("/sales", "layout");
    return { ok: true };
  });
}
