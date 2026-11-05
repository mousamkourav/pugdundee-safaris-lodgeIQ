// Run with:  npx tsx --test lib/sales/payments/auto-booking.test.ts
// "Booked" makes the booking by itself, once, from the latest version; before the payments SQL is
// run, booking a query still works (the booking is just not made).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatTurn, initialFlags } from "@/lib/sales/plan/chat";
import { emptyPlan, planToTrip } from "@/lib/sales/plan/planner";
import { realCtx } from "@/lib/sales/plan/real-fixture";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { createBookingForQuery } from "./server";

type Row = Record<string, unknown>;
// a tiny stand-in for the database client: tables in memory, the filters the code uses
function fakeDb(tables: Record<string, Row[]>, missing = false) {
  let n = 0;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let inserted: Row[] | null = null;
    let order: { col: string; asc: boolean } | null = null;
    let limit = Infinity;
    const err = missing && table.startsWith("sales_book") ? { message: `relation "public.${table}" does not exist`, code: "42P01" } : null;
    const rows = () => {
      let r = (tables[table] ?? []).filter((x) => filters.every((f) => f(x)));
      if (order) r = [...r].sort((a, b) => (order!.asc ? 1 : -1) * (Number(a[order!.col]) - Number(b[order!.col])));
      return r.slice(0, limit);
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), q),
      limit: (k: number) => ((limit = k), q),
      insert: (v: Row | Row[]) => {
        if (err) return { ...q, then: (res: (x: unknown) => void) => res({ data: null, error: err }) };
        const list = (Array.isArray(v) ? v : [v]).map((x) => ({ id: `${table}-${++n}`, deleted_at: null, ...x }));
        (tables[table] ??= []).push(...list);
        inserted = list;
        return q;
      },
      maybeSingle: async () => (err ? { data: null, error: err } : { data: rows()[0] ?? null, error: null }),
      single: async () => (err ? { data: null, error: err } : { data: (inserted ?? rows())[0], error: null }),
      then: (res: (x: unknown) => void) => res({ data: inserted ?? rows(), error: err }),
    };
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const T = "2026-11-05";
let plan = emptyPlan(T);
const flags = initialFlags(plan);
plan = chatTurn(plan, flags, "2 adults from UK, arriving nagpur on 10 jan 2027, pench 3 nights, back to nagpur", realCtx, T).plan;
const pricing = priceTrip(planToTrip(plan, T), realCtx.pricing);
const base = () => ({
  sales_queries: [{ id: "q1", guest_name: "Amy Fine", assigned_to: "u1", booked_at: "2026-11-05T12:00:00+05:30", booked_amount: 50000, payment_ref: "UTR9", status: "booked" }],
  sales_itinerary_versions: [
    { query_id: "q1", version_no: 1, currency: "INR", plan, pricing: { ...pricing, totals: { ...pricing.totals, grand: 1 } } },
    { query_id: "q1", version_no: 2, currency: "INR", plan, pricing },
  ],
});

test("marked Booked: one booking from the latest version, with its lodge, dues and the payment", async () => {
  const tables: Record<string, Row[]> = base();
  const db = fakeDb(tables);
  const r = await createBookingForQuery(db, "q1", T);
  assert.ok(r.id && !r.error, JSON.stringify(r));
  assert.equal(tables.sales_bookings.length, 1);
  assert.equal(tables.sales_bookings[0].version_no, 2);
  assert.equal(tables.sales_bookings[0].owner_id, "u1");
  assert.deepEqual(tables.sales_booking_lines.map((l) => l.lodge_name), ["Pench Tree Lodge"]);
  assert.ok(tables.sales_booking_dues.length >= 1);
  assert.deepEqual(tables.sales_booking_payments.map((p) => [p.amount, p.reference]), [[50000, "UTR9"]]);
  // again (booked, reopened, booked): not twice
  const again = await createBookingForQuery(db, "q1", T);
  assert.equal(again.skipped, "already there");
  assert.equal(tables.sales_bookings.length, 1);
});

test("before the payments SQL is run, booking a query is not stopped", async () => {
  const r = await createBookingForQuery(fakeDb(base(), true), "q1", T);
  assert.equal(r.skipped, "payments not set up");
  assert.equal(r.error, undefined);
});

test("a query with no saved version gets no booking (and no error)", async () => {
  const tables: Record<string, Row[]> = { ...base(), sales_itinerary_versions: [] };
  const r = await createBookingForQuery(fakeDb(tables), "q1", T);
  assert.equal(r.skipped, "no saved version");
  assert.equal((tables.sales_bookings ?? []).length, 0);
});
