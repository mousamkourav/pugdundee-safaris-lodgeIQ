// Run with:  npx tsx --test lib/sales/payments/from-version.test.ts
// The booking made automatically when a quote is marked Booked, from its latest version, on the
// real Master data: a line per lodge with its dates and amounts, the rest on the booking, the dues
// from the payment schedule, and the payment typed in the Booked dialog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "@/lib/sales/plan/chat";
import { emptyPlan, planToTrip } from "@/lib/sales/plan/planner";
import { realCtx } from "@/lib/sales/plan/real-fixture";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { Plan } from "@/lib/sales/plan/types";
import { bookingFromVersion } from "./from-version";
import { bookingTotal, lineTotal, money, status } from "./money";

const T = "2026-11-05";
function read(...msgs: string[]) {
  let plan: Plan = emptyPlan(T);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, realCtx, T);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const plan = read("2 adults from UK, 2 rooms, arriving nagpur on 10 jan 2027, pench 3 nights, then kanha 2 nights, then fly back from jabalpur", "cottage", "cottage");
const pricing = priceTrip(planToTrip(plan, T), realCtx.pricing);
const q = { id: "q1", guest_name: "Marc Burlon", assigned_to: "u1", booked_at: "2026-11-05T12:00:00+05:30", booked_amount: 100000, payment_ref: "UTR123" };
const d = bookingFromVersion(q, { version_no: 3, currency: "INR", plan, pricing }, T);

test("one line per lodge, with its dates, rooms, nights and amounts from the costing", () => {
  assert.deepEqual(d.lines.map((l) => [l.lodge_name, l.check_in, l.check_out, l.rooms, l.nights]), [
    ["Pench Tree Lodge", "2027-01-10", "2027-01-13", 2, 3],
    ["Kanha Earth Lodge", "2027-01-13", "2027-01-15", 2, 2],
  ]);
  for (const l of d.lines) assert.ok(l.room_amount > 0 && l.safari_amount > 0, l.lodge_name);
  assert.equal(d.booking.check_in, "2027-01-10");
  assert.equal(d.booking.check_out, "2027-01-15");
  assert.equal(d.booking.owner_id, "u1");
  assert.equal(d.booking.version_no, 3);
});

test("the booking total is the quote's total (lines + the rest on the booking)", () => {
  const lines = d.lines.map((l, i) => ({ ...l, id: `l${i}`, booking_no: null }));
  const total = bookingTotal({ lines, other_amount: d.booking.other_amount, discount_amount: d.booking.discount_amount });
  assert.equal(total, pricing.totals.grand);
  assert.ok(d.lines.every((l) => lineTotal(l) >= 0));
});

test("dues from the payment schedule add up to the total; the Booked payment is recorded", () => {
  assert.ok(d.dues.length >= 1);
  assert.equal(Math.round(d.dues.reduce((t, x) => t + x.amount, 0)), pricing.totals.grand);
  assert.ok(d.dues.every((x) => x.due_on >= "2026-11-05"));
  assert.deepEqual(d.payment, { kind: "payment", amount: 100000, paid_on: "2026-11-05", mode: "other", reference: "UTR123", note: "Recorded when the query was marked Booked" });
  const b = {
    lines: d.lines.map((l, i) => ({ ...l, id: `l${i}`, booking_no: null })),
    other_amount: d.booking.other_amount,
    discount_amount: d.booking.discount_amount,
    cancelled: false,
    dues: d.dues.map((x, i) => ({ ...x, id: `d${i}` })),
    payments: [{ ...d.payment!, id: "p", line_id: null, received_by: null, attachment_path: null }],
  };
  assert.equal(money(b).balance, pricing.totals.grand - 100000);
  assert.ok(["part_paid", "due_soon", "overdue"].includes(status(b, T)));
});
