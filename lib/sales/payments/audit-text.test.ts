// Run with:  npx tsx --test lib/sales/payments/audit-text.test.ts
// The history lines of a booking, in plain words; and the list filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditText } from "./audit-text";
import { filterBookings, readFilters } from "./filters";
import type { Booking } from "./money";

const names = { u1: "Mona" };
test("history: added, changed (old to new), removed", () => {
  assert.equal(auditText({ table_name: "sales_booking_payments", action: "insert", old_row: null, new_row: { kind: "payment", amount: 70500 }, actor: "u1" }, names), "Mona added a payment of Rs 70,500.");
  assert.equal(
    auditText({ table_name: "sales_booking_payments", action: "update", old_row: { kind: "payment", amount: 161500, paid_on: "2026-09-03", updated_at: "a" }, new_row: { kind: "payment", amount: 161000, paid_on: "2026-09-03", updated_at: "b" }, actor: "u1" }, names),
    "Mona changed a payment of Rs 1,61,000: amount Rs 1,61,500 to Rs 1,61,000."
  );
  assert.equal(auditText({ table_name: "sales_booking_payments", action: "update", old_row: { kind: "refund", amount: 5000, deleted_at: null }, new_row: { kind: "refund", amount: 5000, deleted_at: "x" }, actor: "u2" }, names), "Someone removed a refund of Rs 5,000.");
  assert.equal(auditText({ table_name: "sales_booking_lines", action: "update", old_row: { lodge_name: "Kings Lodge", booking_no: null }, new_row: { lodge_name: "Kings Lodge", booking_no: "KIN0005709" }, actor: "u1" }, names), "Mona changed the lodge booking Kings Lodge KIN0005709: booking no. - to KIN0005709.");
});

const b = (o: Partial<Booking>): Booking => ({
  id: "x", query_id: null, version_no: null, guest_name: "Amy Fine", owner_id: "00000000-0000-4000-8000-0000000000a1", check_in: "2026-10-05", check_out: "2026-10-08", currency: "INR",
  other_amount: 0, discount_amount: 0, booked_on: null, cancelled: false, cancelled_on: null, source: "manual", notes: null, lines: [], dues: [], payments: [], ...o,
});
test("filters: month, status, lodge, salesperson, search by guest / booking no. / query no.", () => {
  const line = { id: "l", lodge_name: "Kings Lodge", booking_no: "KIN0005709", check_in: "2026-10-06", check_out: "2026-10-08", rooms: 2, nights: 4, room_amount: 62540, safari_amount: 42000, transfer_amount: 0, other_amount: 0, sort: 0 };
  const all = [b({ id: "a", lines: [line], query_no: "Q-2026-0042" }), b({ id: "c", guest_name: "Marc Burlon", owner_id: "00000000-0000-4000-8000-0000000000a2", check_in: "2026-11-01", cancelled: true })];
  const ids = (sp: Record<string, string>) => filterBookings(all, readFilters(sp), "2026-10-01").map((x) => x.id);
  assert.deepEqual(ids({ month: "2026-10" }), ["a"]);
  assert.deepEqual(ids({ status: "cancelled" }), ["c"]);
  assert.deepEqual(ids({ lodge: "Kings Lodge" }), ["a"]);
  assert.deepEqual(ids({ owner: "00000000-0000-4000-8000-0000000000a2" }), ["c"]);
  assert.deepEqual(ids({ owner: "not-an-id" }), ["a", "c"]); // ignored
  assert.deepEqual(ids({ q: "kin00057" }), ["a"]);
  assert.deepEqual(ids({ q: "marc" }), ["c"]);
  assert.deepEqual(ids({ q: "q-2026-0042" }), ["a"]);
  assert.deepEqual(ids({ month: "nonsense", status: "bogus" }), ["a", "c"]);
});
