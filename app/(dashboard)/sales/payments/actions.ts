"use server";

// Payments tracker actions. Every one checks the user here and the database checks again (row level
// security: admins all bookings; a sales member their own). Every change is written to the audit
// table by a trigger, with the reason typed here.
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesAdmin, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAYMENT_MODES, parseMoney, type PaymentKind, type PaymentMode } from "@/lib/sales/payments/money";
import { createBookingForQuery, notReady } from "@/lib/sales/payments/server";
import type { ImportBooking } from "@/lib/sales/payments/import-sheet";

type Result = { ok?: boolean; error?: string; id?: string };
const BUCKET = "sales-payments";
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const clean = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, max: number) => {
  const x = Number(v);
  return Number.isInteger(x) && x >= 0 && x <= max ? x : null;
};
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const KINDS: PaymentKind[] = ["payment", "refund", "cancellation_charge"];

async function guard() {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return null;
  return { user: cu.user, admin: isSalesAdmin(cu.profile?.role), supabase: await createClient() };
}
const done = (bookingId?: string) => {
  revalidatePath("/sales/payments");
  if (bookingId) revalidatePath(`/sales/payments/${bookingId}`);
  revalidatePath("/sales");
};
const dbError = (e: { message: string; code?: string }) =>
  notReady(e) ? "Payments are not set up yet: run supabase/sales_payments.sql in Supabase." : /row-level security|permission/i.test(e.message) ? "You can change only your own bookings." : /check constraint/i.test(e.message) ? "A value is not allowed (amounts 0 or more, check-out not before check-in)." : e.message;

// ---------------------------------------------------------------- payments
export interface PaymentInput {
  booking_id: string;
  line_id?: string | null;
  kind: PaymentKind;
  amount: string | number;
  paid_on: string;
  mode: PaymentMode;
  reference?: string;
  received_by?: string;
  note?: string;
  attachment_path?: string | null;
}
function checkPayment(i: PaymentInput): { row?: Record<string, unknown>; error?: string } {
  if (!isId(i.booking_id)) return { error: "Booking not found." };
  if (!KINDS.includes(i.kind)) return { error: "Choose payment, refund or cancellation charge." };
  const amount = parseMoney(i.amount, { positive: true });
  if (amount === null) return { error: "Enter the amount in rupees (more than 0)." };
  if (!isDate(i.paid_on)) return { error: "Enter the date." };
  if (!PAYMENT_MODES.includes(i.mode)) return { error: "Choose how it was paid." };
  if (i.line_id && !isId(i.line_id)) return { error: "Lodge booking not found." };
  if (i.attachment_path && !(typeof i.attachment_path === "string" && i.attachment_path.startsWith(`${i.booking_id}/`) && i.attachment_path.length < 300)) return { error: "The attachment is not of this booking." };
  return {
    row: {
      booking_id: i.booking_id,
      line_id: i.line_id || null,
      kind: i.kind,
      amount,
      paid_on: i.paid_on,
      mode: i.mode,
      reference: clean(i.reference, 200) || null,
      received_by: clean(i.received_by, 120) || null,
      note: clean(i.note, 1000) || null,
      ...(i.attachment_path !== undefined ? { attachment_path: i.attachment_path || null } : {}),
    },
  };
}

export async function addPayment(input: PaymentInput): Promise<Result> {
  return safe("addPayment", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    const c = checkPayment(input);
    if (c.error) return { error: c.error };
    const { data, error } = await w.supabase.from("sales_booking_payments").insert({ ...c.row, change_reason: null }).select("id").single();
    if (error) return { error: dbError(error) };
    done(input.booking_id);
    return { ok: true, id: String((data as { id: string }).id) };
  });
}

export async function updatePayment(id: string, input: PaymentInput, reason: string): Promise<Result> {
  return safe("updatePayment", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(id)) return { error: "Payment not found." };
    if (!clean(reason)) return { error: "Say why it is changed." };
    const c = checkPayment(input);
    if (c.error) return { error: c.error };
    const { data, error } = await w.supabase.from("sales_booking_payments").update({ ...c.row, change_reason: clean(reason) }).eq("id", id).is("deleted_at", null).select("id");
    if (error) return { error: dbError(error) };
    if (!data?.length) return { error: "Payment not found, or it is not on your booking." };
    done(input.booking_id);
    return { ok: true };
  });
}

// removed, not deleted: the entry and the reason stay in the history
export async function removePayment(id: string, bookingId: string, reason: string): Promise<Result> {
  return safe("removePayment", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(id)) return { error: "Payment not found." };
    if (!clean(reason)) return { error: "Say why it is removed." };
    const { data, error } = await w.supabase.from("sales_booking_payments").update({ deleted_at: new Date().toISOString(), change_reason: clean(reason) }).eq("id", id).is("deleted_at", null).select("id");
    if (error) return { error: dbError(error) };
    if (!data?.length) return { error: "Payment not found, or it is not on your booking." };
    done(bookingId);
    return { ok: true };
  });
}

// A signed link to upload a receipt straight to the private bucket (big files do not pass through
// the server). The booking must be one the user can see.
export async function attachmentUpload(bookingId: string, fileName: string, type: string, size: number): Promise<{ path?: string; token?: string; error?: string }> {
  return safe("attachmentUpload", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(bookingId)) return { error: "Booking not found." };
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[type];
    if (!ext) return { error: "Attach a photo (JPG, PNG, WebP) or a PDF." };
    if (!(size > 0 && size <= 5 * 1024 * 1024)) return { error: "The file must be 5 MB or less." };
    const { data: b } = await w.supabase.from("sales_bookings").select("id").eq("id", bookingId).maybeSingle();
    if (!b) return { error: "Booking not found." };
    void fileName;
    const path = `${bookingId}/${randomUUID()}.${ext}`;
    const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { error: notReady(error) || /bucket/i.test(error?.message ?? "") ? "Run supabase/sales_payments.sql first (the attachments store)." : error?.message ?? "Could not prepare the upload." };
    return { path, token: data.token };
  });
}

// ---------------------------------------------------------------- the booking
export interface BookingInput {
  guest_name: string;
  check_in: string | null;
  check_out: string | null;
  other_amount: string | number;
  discount_amount: string | number;
  notes?: string;
  cancelled?: boolean;
  owner_id?: string | null; // admins only
}
function checkBooking(i: BookingInput, admin: boolean): { row?: Record<string, unknown>; error?: string } {
  const guest = clean(i.guest_name, 200);
  if (!guest) return { error: "Enter the guest's name." };
  if (i.check_in && !isDate(i.check_in)) return { error: "Check the check-in date." };
  if (i.check_out && !isDate(i.check_out)) return { error: "Check the check-out date." };
  if (i.check_in && i.check_out && i.check_out < i.check_in) return { error: "Check-out is before check-in." };
  const other = parseMoney(i.other_amount === "" ? 0 : i.other_amount);
  const discount = parseMoney(i.discount_amount === "" ? 0 : i.discount_amount);
  if (other === null || discount === null) return { error: "Amounts must be rupees, 0 or more." };
  return {
    row: {
      guest_name: guest,
      check_in: i.check_in || null,
      check_out: i.check_out || null,
      other_amount: other,
      discount_amount: discount,
      notes: clean(i.notes, 2000) || null,
      ...(i.cancelled !== undefined ? { cancelled: !!i.cancelled, cancelled_on: i.cancelled ? today() : null } : {}),
      ...(admin && i.owner_id !== undefined ? { owner_id: isId(i.owner_id) ? i.owner_id : null } : {}),
    },
  };
}

export async function saveBooking(id: string, input: BookingInput, reason: string): Promise<Result> {
  return safe("saveBooking", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(id)) return { error: "Booking not found." };
    if (!clean(reason)) return { error: "Say why it is changed." };
    const c = checkBooking(input, w.admin);
    if (c.error) return { error: c.error };
    const { data, error } = await w.supabase.from("sales_bookings").update({ ...c.row, change_reason: clean(reason) }).eq("id", id).is("deleted_at", null).select("id");
    if (error) return { error: dbError(error) };
    if (!data?.length) return { error: "Booking not found, or it is not yours." };
    done(id);
    return { ok: true };
  });
}

export async function createBooking(input: BookingInput): Promise<Result> {
  return safe("createBooking", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    const c = checkBooking(input, w.admin);
    if (c.error) return { error: c.error };
    const owner = w.admin && input.owner_id !== undefined ? (isId(input.owner_id) ? input.owner_id : null) : w.user.id;
    const { data, error } = await w.supabase
      .from("sales_bookings")
      .insert({ ...c.row, owner_id: owner, source: "manual", booked_on: today(), change_reason: "Added by hand" })
      .select("id")
      .single();
    if (error) return { error: dbError(error) };
    done();
    return { ok: true, id: String((data as { id: string }).id) };
  });
}

// admins: the booking is hidden (kept in the database with the reason)
export async function deleteBooking(id: string, reason: string): Promise<Result> {
  return safe("deleteBooking", async () => {
    const w = await guard();
    if (!w?.admin) return { error: "Only Sales admins can delete a booking." };
    if (!isId(id)) return { error: "Booking not found." };
    if (!clean(reason)) return { error: "Say why it is deleted." };
    const { data, error } = await w.supabase.from("sales_bookings").update({ deleted_at: new Date().toISOString(), change_reason: clean(reason) }).eq("id", id).is("deleted_at", null).select("id");
    if (error) return { error: dbError(error) };
    if (!data?.length) return { error: "Booking not found." };
    done();
    return { ok: true };
  });
}

// ---------------------------------------------------------------- lodge lines
export interface LineInput {
  lodge_name: string;
  booking_no?: string;
  check_in: string | null;
  check_out: string | null;
  rooms: string | number;
  nights: string | number;
  room_amount: string | number;
  safari_amount: string | number;
  transfer_amount: string | number;
  other_amount: string | number;
}
function checkLine(i: LineInput): { row?: Record<string, unknown>; error?: string } {
  if (i.check_in && !isDate(i.check_in)) return { error: "Check the check-in date." };
  if (i.check_out && !isDate(i.check_out)) return { error: "Check the check-out date." };
  if (i.check_in && i.check_out && i.check_out < i.check_in) return { error: "Check-out is before check-in." };
  const rooms = int(i.rooms === "" ? 0 : i.rooms, 100);
  const nights = int(i.nights === "" ? 0 : i.nights, 1000);
  if (rooms === null || nights === null) return { error: "Rooms and nights are whole numbers, 0 or more." };
  const m = (v: string | number) => parseMoney(v === "" ? 0 : v);
  const amounts = { room_amount: m(i.room_amount), safari_amount: m(i.safari_amount), transfer_amount: m(i.transfer_amount), other_amount: m(i.other_amount) };
  if (Object.values(amounts).some((x) => x === null)) return { error: "Amounts must be rupees, 0 or more." };
  const no = clean(i.booking_no, 40).toUpperCase();
  return { row: { lodge_name: clean(i.lodge_name, 200), booking_no: no || null, check_in: i.check_in || null, check_out: i.check_out || null, rooms, nights, ...amounts } };
}

export async function saveLine(bookingId: string, lineId: string | null, input: LineInput, reason: string): Promise<Result> {
  return safe("saveLine", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(bookingId) || (lineId && !isId(lineId))) return { error: "Booking not found." };
    if (lineId && !clean(reason)) return { error: "Say why it is changed." };
    const c = checkLine(input);
    if (c.error) return { error: c.error };
    if (lineId) {
      const { data, error } = await w.supabase.from("sales_booking_lines").update({ ...c.row, change_reason: clean(reason) }).eq("id", lineId).eq("booking_id", bookingId).select("id");
      if (error) return { error: dbError(error) };
      if (!data?.length) return { error: "Lodge booking not found, or it is not yours." };
    } else {
      const { count } = await w.supabase.from("sales_booking_lines").select("id", { count: "exact", head: true }).eq("booking_id", bookingId);
      const { error } = await w.supabase.from("sales_booking_lines").insert({ ...c.row, booking_id: bookingId, sort: count ?? 0, change_reason: clean(reason) || "Added" });
      if (error) return { error: dbError(error) };
    }
    done(bookingId);
    return { ok: true };
  });
}

export async function removeLine(bookingId: string, lineId: string, reason: string): Promise<Result> {
  return safe("removeLine", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(bookingId) || !isId(lineId)) return { error: "Lodge booking not found." };
    if (!clean(reason)) return { error: "Say why it is removed." };
    // the reason goes in first, so the history of the removal carries it
    await w.supabase.from("sales_booking_lines").update({ change_reason: clean(reason) }).eq("id", lineId).eq("booking_id", bookingId);
    const { data, error } = await w.supabase.from("sales_booking_lines").delete().eq("id", lineId).eq("booking_id", bookingId).select("id");
    if (error) return { error: dbError(error) };
    if (!data?.length) return { error: "Lodge booking not found, or it is not yours." };
    done(bookingId);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- dues
export async function saveDue(bookingId: string, dueId: string | null, input: { label: string; due_on: string; amount: string | number }, reason: string): Promise<Result> {
  return safe("saveDue", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(bookingId) || (dueId && !isId(dueId))) return { error: "Booking not found." };
    if (dueId && !clean(reason)) return { error: "Say why it is changed." };
    if (!isDate(input.due_on)) return { error: "Enter the due date." };
    const amount = parseMoney(input.amount);
    if (amount === null) return { error: "Enter the amount in rupees (0 or more)." };
    const row = { label: clean(input.label, 200) || "Due", due_on: input.due_on, amount, change_reason: clean(reason) || "Added" };
    const r = dueId
      ? await w.supabase.from("sales_booking_dues").update(row).eq("id", dueId).eq("booking_id", bookingId).select("id")
      : await w.supabase.from("sales_booking_dues").insert({ ...row, booking_id: bookingId }).select("id");
    if (r.error) return { error: dbError(r.error) };
    if (!r.data?.length) return { error: "Due date not found, or it is not yours." };
    done(bookingId);
    return { ok: true };
  });
}

export async function removeDue(bookingId: string, dueId: string, reason: string): Promise<Result> {
  return safe("removeDue", async () => {
    const w = await guard();
    if (!w) return { error: "You do not have access to Sales." };
    if (!isId(bookingId) || !isId(dueId)) return { error: "Due date not found." };
    if (!clean(reason)) return { error: "Say why it is removed." };
    await w.supabase.from("sales_booking_dues").update({ change_reason: clean(reason) }).eq("id", dueId).eq("booking_id", bookingId);
    const { data, error } = await w.supabase.from("sales_booking_dues").delete().eq("id", dueId).eq("booking_id", bookingId).select("id");
    if (error) return { error: dbError(error) };
    if (!data?.length) return { error: "Due date not found, or it is not yours." };
    done(bookingId);
    return { ok: true };
  });
}

// ---------------------------------------------------------------- admin tools
// Bookings for queries booked before the tracker existed (or whose booking could not be made).
export async function createMissingBookings(): Promise<Result & { made?: number; skipped?: number }> {
  return safe("createMissingBookings", async () => {
    const w = await guard();
    if (!w?.admin) return { error: "Only Sales admins can do this." };
    const { data: booked, error } = await w.supabase.from("sales_queries").select("id").eq("status", "booked").is("deleted_at", null).limit(2000);
    if (error) return { error: error.message };
    let made = 0;
    let skipped = 0;
    for (const q of (booked ?? []) as { id: string }[]) {
      const r = await createBookingForQuery(w.supabase, q.id, today());
      if (r.error) return { error: dbError({ message: r.error }) };
      if (r.skipped) skipped++;
      else made++;
    }
    done();
    return { ok: true, made, skipped };
  });
}

// The one-time import of the payments Excel (after the preview). Checked again here.
export async function importBookings(bookings: ImportBooking[]): Promise<Result & { made?: number; skipped?: string[] }> {
  return safe("importBookings", async () => {
    const w = await guard();
    if (!w?.admin) return { error: "Only Sales admins can import." };
    if (!Array.isArray(bookings) || bookings.length > 5000) return { error: "Nothing to import." };
    const skipped: string[] = [];
    // booking numbers already in LodgeIQ are not imported twice
    const nos = bookings.flatMap((b) => b.lines.map((l) => l.booking_no)).filter((x): x is string => !!x);
    const have = new Set<string>();
    for (let i = 0; i < nos.length; i += 150) {
      const { data, error } = await w.supabase.from("sales_booking_lines").select("booking_no").in("booking_no", nos.slice(i, i + 150));
      if (error) return { error: dbError(error) };
      for (const r of (data ?? []) as { booking_no: string }[]) have.add(r.booking_no);
    }
    let made = 0;
    for (const b of bookings) {
      const guest = clean(b.guest_name, 200);
      const lines = (b.lines ?? []).filter((l) => {
        if (l.booking_no && have.has(l.booking_no)) {
          skipped.push(`${guest}, ${l.booking_no}: already in LodgeIQ.`);
          return false;
        }
        return true;
      });
      if (!guest || !lines.length) continue;
      const checked = lines.map((l) => ({ l, c: checkLine({ ...l, booking_no: l.booking_no ?? "" }) }));
      const bad = checked.find((x) => x.c.error);
      if (bad) {
        skipped.push(`${guest}, row ${bad.l.row}: ${bad.c.error}`);
        continue;
      }
      const ci = lines.map((l) => l.check_in).sort()[0];
      const co = lines.map((l) => l.check_out).sort().slice(-1)[0];
      const { data, error } = await w.supabase.from("sales_bookings").insert({ guest_name: guest, owner_id: null, check_in: ci, check_out: co, source: "import", change_reason: "Imported from the payments Excel" }).select("id").single();
      if (error) return { error: dbError(error), made };
      const id = String((data as { id: string }).id);
      for (const [k, { l, c }] of checked.entries()) {
        const { data: line, error: el } = await w.supabase.from("sales_booking_lines").insert({ ...c.row, booking_id: id, sort: k, change_reason: `Imported (row ${l.row})` }).select("id").single();
        if (el) return { error: dbError(el), made };
        const pays = l.payments
          .map((p) => ({ p, amount: parseMoney(p.amount, { positive: true }) }))
          .filter((x) => x.amount !== null && (x.p.paid_on === null || isDate(x.p.paid_on)) && PAYMENT_MODES.includes(x.p.mode))
          .map(({ p, amount }) => ({ booking_id: id, line_id: String((line as { id: string }).id), kind: "payment", amount, paid_on: p.paid_on, mode: p.mode, note: clean(p.note, 1000) || null, change_reason: `Imported (row ${l.row})` }));
        if (pays.length) {
          const { error: ep } = await w.supabase.from("sales_booking_payments").insert(pays);
          if (ep) return { error: dbError(ep), made };
        }
      }
      made++;
    }
    done();
    return { ok: true, made, skipped };
  });
}
