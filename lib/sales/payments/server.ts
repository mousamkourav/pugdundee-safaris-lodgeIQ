// Server-only: reading and creating bookings with the signed-in user's database client, so row
// level security decides what each person sees (admins all; a sales member their own).
import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingFromVersion, type QueryForBooking, type VersionForBooking } from "./from-version";
import type { Booking, BookingDue, BookingLine, BookingPayment } from "./money";

type Row = Record<string, unknown>;
const PAGE = 1000;
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

// The payments tables are not there yet (supabase/sales_payments.sql not run).
export const notReady = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (/does not exist|schema cache|Could not find the table/i.test(e.message ?? "") || e.code === "42P01" || e.code === "PGRST205");

export const BOOKING_COLUMNS =
  "id, query_id, version_no, guest_name, owner_id, check_in, check_out, currency, other_amount, discount_amount, booked_on, cancelled, cancelled_on, source, notes, created_at";

const toLine = (r: Row): BookingLine & { booking_id: string } => ({
  id: String(r.id),
  booking_id: String(r.booking_id),
  lodge_name: String(r.lodge_name ?? ""),
  property_id: s(r.property_id),
  booking_no: s(r.booking_no),
  check_in: s(r.check_in),
  check_out: s(r.check_out),
  rooms: n(r.rooms),
  nights: n(r.nights),
  room_amount: n(r.room_amount),
  safari_amount: n(r.safari_amount),
  transfer_amount: n(r.transfer_amount),
  other_amount: n(r.other_amount),
  sort: n(r.sort),
});
const toDue = (r: Row): BookingDue & { booking_id: string } => ({ id: String(r.id), booking_id: String(r.booking_id), label: String(r.label ?? ""), due_on: String(r.due_on), amount: n(r.amount), sort: n(r.sort) });
const toPayment = (r: Row): BookingPayment & { booking_id: string } => ({
  id: String(r.id),
  booking_id: String(r.booking_id),
  line_id: s(r.line_id),
  kind: (r.kind as BookingPayment["kind"]) ?? "payment",
  amount: n(r.amount),
  paid_on: s(r.paid_on),
  mode: (r.mode as BookingPayment["mode"]) ?? "other",
  reference: s(r.reference),
  received_by: s(r.received_by),
  note: s(r.note),
  attachment_path: s(r.attachment_path),
  deleted_at: s(r.deleted_at),
  created_at: s(r.created_at) ?? undefined,
});
const toBooking = (r: Row): Booking => ({
  id: String(r.id),
  query_id: s(r.query_id),
  version_no: r.version_no === null || r.version_no === undefined ? null : n(r.version_no),
  guest_name: String(r.guest_name ?? ""),
  owner_id: s(r.owner_id),
  check_in: s(r.check_in),
  check_out: s(r.check_out),
  currency: String(r.currency ?? "INR"),
  other_amount: n(r.other_amount),
  discount_amount: n(r.discount_amount),
  booked_on: s(r.booked_on),
  cancelled: r.cancelled === true,
  cancelled_on: s(r.cancelled_on),
  source: (r.source as Booking["source"]) ?? "manual",
  notes: s(r.notes),
  lines: [],
  dues: [],
  payments: [],
});

// Every booking the user may see (not deleted), with its lines, dues and payments, and query numbers.
export async function loadBookings(supabase: SupabaseClient, opts: { ids?: string[] } = {}): Promise<{ bookings: Booking[]; error: string | null; notReady: boolean }> {
  const rows: Row[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    let q = supabase.from("sales_bookings").select(BOOKING_COLUMNS).is("deleted_at", null);
    if (opts.ids) q = q.in("id", opts.ids);
    const { data, error } = await q.order("check_in", { ascending: true, nullsFirst: false }).order("id").range(offset, offset + PAGE - 1);
    if (error) return { bookings: [], error: error.message, notReady: notReady(error) };
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < PAGE) break;
  }
  const bookings = rows.map(toBooking);
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const ids = bookings.map((b) => b.id);
  // children, in chunks (a long "in" list makes a long URL)
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [lines, dues, pays] = await Promise.all([
      supabase.from("sales_booking_lines").select("*").in("booking_id", chunk).order("sort"),
      supabase.from("sales_booking_dues").select("*").in("booking_id", chunk).order("due_on"),
      supabase.from("sales_booking_payments").select("*").in("booking_id", chunk).is("deleted_at", null).order("paid_on", { ascending: true, nullsFirst: true }),
    ]);
    const err = lines.error ?? dues.error ?? pays.error;
    if (err) return { bookings: [], error: err.message, notReady: notReady(err) };
    for (const r of (lines.data ?? []) as Row[]) byId.get(String(r.booking_id))?.lines.push(toLine(r));
    for (const r of (dues.data ?? []) as Row[]) byId.get(String(r.booking_id))?.dues.push(toDue(r));
    for (const r of (pays.data ?? []) as Row[]) byId.get(String(r.booking_id))?.payments.push(toPayment(r));
  }
  // the query numbers (the queries' own rules decide what is visible)
  const qids = [...new Set(bookings.map((b) => b.query_id).filter((x): x is string => !!x))];
  for (let i = 0; i < qids.length; i += 150) {
    const { data } = await supabase.from("sales_queries").select("id, query_no").in("id", qids.slice(i, i + 150));
    const no = new Map(((data ?? []) as Row[]).map((r) => [String(r.id), s(r.query_no)]));
    for (const b of bookings) if (b.query_id && no.has(b.query_id)) b.query_no = no.get(b.query_id) ?? null;
  }
  return { bookings, error: null, notReady: false };
}

export async function loadBooking(supabase: SupabaseClient, id: string) {
  const r = await loadBookings(supabase, { ids: [id] });
  return { ...r, booking: r.bookings[0] ?? null };
}

// The deleted payments of a booking too (shown struck through in its history).
export async function loadRemovedPayments(supabase: SupabaseClient, bookingId: string) {
  const { data } = await supabase.from("sales_booking_payments").select("*").eq("booking_id", bookingId).not("deleted_at", "is", null).order("deleted_at");
  return ((data ?? []) as Row[]).map((r) => ({ ...toPayment(r), change_reason: s(r.change_reason) }));
}

export async function loadAudit(supabase: SupabaseClient, bookingId: string) {
  const { data } = await supabase.from("sales_booking_audit").select("id, table_name, action, old_row, new_row, reason, actor, at").eq("booking_id", bookingId).order("at", { ascending: false }).limit(200);
  return (data ?? []) as { id: number; table_name: string; action: string; old_row: Row | null; new_row: Row | null; reason: string | null; actor: string | null; at: string }[];
}

// When a query is marked Booked: its booking, from the latest version (once). Never throws: a
// booking that cannot be made (the SQL not run yet) does not stop the query being booked.
export async function createBookingForQuery(supabase: SupabaseClient, queryId: string, today: string): Promise<{ id?: string; error?: string; skipped?: string }> {
  try {
    const { data: have, error: e0 } = await supabase.from("sales_bookings").select("id").eq("query_id", queryId).is("deleted_at", null).maybeSingle();
    if (e0) return notReady(e0) ? { skipped: "payments not set up" } : { error: e0.message };
    if (have) return { id: String((have as Row).id), skipped: "already there" };
    const [{ data: q }, { data: v }] = await Promise.all([
      supabase.from("sales_queries").select("id, guest_name, assigned_to, booked_at, booked_amount, payment_ref").eq("id", queryId).maybeSingle(),
      supabase.from("sales_itinerary_versions").select("version_no, currency, plan, pricing").eq("query_id", queryId).order("version_no", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!q) return { error: "query not found" };
    if (!v || !(v as Row).pricing || !(v as Row).plan) return { skipped: "no saved version" };
    const d = bookingFromVersion(q as unknown as QueryForBooking, v as unknown as VersionForBooking, today);
    const { data: b, error } = await supabase.from("sales_bookings").insert({ ...d.booking, change_reason: "Made when the query was marked Booked" }).select("id").single();
    if (error) return { error: error.message };
    const id = String((b as Row).id);
    if (d.lines.length) {
      const { error: el } = await supabase.from("sales_booking_lines").insert(d.lines.map((l) => ({ ...l, booking_id: id })));
      if (el) return { id, error: el.message };
    }
    if (d.dues.length) {
      const { error: ed } = await supabase.from("sales_booking_dues").insert(d.dues.map((x) => ({ ...x, booking_id: id })));
      if (ed) return { id, error: ed.message };
    }
    if (d.payment) {
      const { error: ep } = await supabase.from("sales_booking_payments").insert({ ...d.payment, booking_id: id });
      if (ep) return { id, error: ep.message };
    }
    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
