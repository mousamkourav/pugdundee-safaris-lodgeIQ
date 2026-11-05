// Run with:  npx tsx --test lib/sales/payments/money.test.ts
// Balance maths (several payments, a refund, a cancellation charge), the status rules and the
// split of payments over the lodge lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { byLine, money, nextDue, parseMoney, status, summarise, type Booking, type BookingLine, type BookingPayment } from "./money";

const line = (id: string, room: number, safari = 0, transfer = 0, sort = 0): BookingLine => ({
  id, lodge_name: id, booking_no: null, check_in: "2026-10-19", check_out: "2026-10-21", rooms: 1, nights: 2,
  room_amount: room, safari_amount: safari, transfer_amount: transfer, other_amount: 0, sort,
});
let n = 0;
const pay = (amount: number, paid_on: string, kind: BookingPayment["kind"] = "payment", line_id: string | null = null): BookingPayment => ({
  id: `p${++n}`, line_id, kind, amount, paid_on, mode: "bank_transfer", reference: null, received_by: null, note: null, attachment_path: null,
});
const booking = (o: Partial<Booking> = {}): Booking => ({
  id: "b", query_id: null, version_no: null, guest_name: "Viraj Anil Gokhale", owner_id: null, check_in: "2026-10-19", check_out: "2026-10-21",
  currency: "INR", other_amount: 0, discount_amount: 0, booked_on: "2026-08-10", cancelled: false, cancelled_on: null, source: "manual", notes: null,
  lines: [line("KIN0005660", 230100)], dues: [], payments: [], ...o,
});

test("balance: total - payments (the sheet's Viraj Gokhale row: 2,30,100 - 70,500 - 1,41,750 = 17,850)", () => {
  const b = booking({ payments: [pay(70500, "2026-08-10"), pay(141750, "2026-10-15")] });
  const m = money(b);
  assert.equal(m.total, 230100);
  assert.equal(m.received, 212250);
  assert.equal(m.balance, 17850);
  assert.equal(m.warning, null);
});

test("refunds add back, removed payments do not count, booking extras and discount count", () => {
  const b = booking({
    other_amount: 5000,
    discount_amount: 1000,
    payments: [pay(100000, "2026-08-10"), pay(20000, "2026-08-11"), pay(10000, "2026-08-12", "refund"), { ...pay(99999, "2026-08-13"), deleted_at: "2026-08-14" }],
  });
  const m = money(b);
  assert.equal(m.total, 234100);
  assert.equal(m.net, 110000);
  assert.equal(m.balance, 124100);
});

test("a cancelled booking owes its cancellation charge; more held = a refund due, with a warning", () => {
  const b = booking({ cancelled: true, payments: [pay(100000, "2026-08-10"), pay(25000, "2026-09-01", "cancellation_charge")] });
  const m = money(b);
  assert.equal(m.owed, 25000);
  assert.equal(m.balance, -75000);
  assert.match(m.warning!, /Refund due to the guest: 75000/);
  // the refund made: settled
  const done = money({ ...b, payments: [...b.payments, pay(75000, "2026-09-05", "refund")] });
  assert.equal(done.balance, 0);
  assert.equal(done.warning, null);
  assert.equal(status({ ...b }, "2026-09-02"), "cancelled");
});

test("overpaid: never negative without a warning", () => {
  const m = money(booking({ payments: [pay(240000, "2026-08-10")] }));
  assert.equal(m.balance, -9900);
  assert.match(m.warning!, /more than the total by 9900/);
});

test("status: paid, overdue, due soon (7 days), partly paid, not paid yet", () => {
  const dues = [
    { id: "d1", label: "Deposit", due_on: "2026-08-10", amount: 70500, sort: 0 },
    { id: "d2", label: "Balance", due_on: "2026-10-04", amount: 159600, sort: 1 },
  ];
  const b = booking({ dues, payments: [pay(70500, "2026-08-10")] });
  assert.equal(status(b, "2026-09-01"), "part_paid");
  assert.equal(status(b, "2026-09-28"), "due_soon"); // balance due on 4 Oct, within 7 days
  assert.equal(status(b, "2026-10-04"), "due_soon"); // due today: not late yet
  assert.equal(status(b, "2026-10-05"), "overdue");
  assert.deepEqual(nextDue(b), { due_on: "2026-10-04", amount: 159600 });
  assert.equal(status(booking({ dues }), "2026-08-01"), "not_paid");
  assert.equal(status(booking({ dues }), "2026-08-11"), "overdue"); // the deposit was due on booking
  const paid = booking({ dues, payments: [pay(70500, "2026-08-10"), pay(159600, "2026-10-01")] });
  assert.equal(status(paid, "2026-10-10"), "paid");
  assert.equal(nextDue(paid), null);
});

test("payments per lodge line: a payment for a line counts there, the rest fills the lines in order", () => {
  // Jerome: three lodges (WEL, PTL, KEL), one payment each in the sheet
  const lines = [line("WEL0012031", 216873, 199500, 19950, 0), line("PTL0004642", 86749, 58275, 9450, 1), line("KEL0003606", 216873, 155400, 9450, 2)];
  const each = byLine({ lines, payments: [pay(436323, "2025-07-28", "payment", "WEL0012031"), pay(154474, "2025-07-28", "payment", "PTL0004642"), pay(381723, "2025-07-28", "payment", "KEL0003606")] });
  assert.deepEqual([...each.values()].map((x) => x.balance), [0, 0, 0]);
  // one payment for the whole trip: the first lodges are paid first
  const one = byLine({ lines, payments: [pay(500000, "2025-07-28")] });
  assert.deepEqual([...one.values()].map((x) => [x.paid, x.balance]), [[436323, 0], [63677, 90797], [0, 381723]]);
});

test("dashboard figures: received this month, balance, overdue, due this week", () => {
  const today = "2026-10-01";
  const a = booking({ id: "a", dues: [{ id: "x", label: "Balance", due_on: "2026-09-20", amount: 230100, sort: 0 }], payments: [pay(200000, "2026-09-10")] }); // 30,100 overdue
  const b = booking({ id: "b", dues: [{ id: "y", label: "Balance", due_on: "2026-10-05", amount: 230100, sort: 0 }], payments: [pay(100000, "2026-10-01")] }); // 1,30,100 due this week
  const c = booking({ id: "c", cancelled: true, payments: [pay(50000, "2026-08-01"), pay(50000, "2026-08-02", "cancellation_charge")] });
  const s = summarise([a, b, c], today);
  assert.equal(s.value, 460200);
  assert.equal(s.balance, 160200);
  assert.deepEqual(s.overdue, { count: 1, amount: 30100 });
  assert.equal(s.dueThisWeek, 130100);
  assert.equal(s.receivedThisMonth, 100000);
});

test("typed amounts: rupees, never negative or text", () => {
  assert.equal(parseMoney("1,61,500"), 161500);
  assert.equal(parseMoney("Rs 500"), 500);
  assert.equal(parseMoney("-5"), null);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(""), null);
  assert.equal(parseMoney("0", { positive: true }), null);
  assert.equal(parseMoney(1e12), null);
});
