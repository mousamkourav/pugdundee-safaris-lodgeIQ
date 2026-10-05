// Checks the pricing engine against the Tadoba - Pench costing sheet.
// Run with:  npx tsx --test lib/sales/pricing/pricing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip, paymentSchedule, occupancy } from "./engine";
import { data, trip, both } from "./sheet-fixture";

test("rack rate matches the sheet: 5,58,670", () => {
  const r = priceTrip(trip, data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.totals.room, 305620);
  assert.equal(r.totals.safari, 224700);
  assert.equal(r.totals.transfer, 28350);
  assert.equal(r.totals.grand, 558670);
  assert.equal(r.perPerson, 279335);
  // a night costs 43,660 for the two cottages
  assert.ok(r.lines.filter((l) => l.kind === "room").every((l) => l.amount === 43660));
  // Sunday safaris at the weekend rate
  const sunday = r.lines.filter((l) => l.kind === "safari" && l.date === "2027-01-17").reduce((t, l) => t + l.amount, 0);
  assert.equal(sunday, 52500);
});

test("lodge split matches the sheet (rack)", () => {
  const r = priceTrip(trip, data);
  const wel = r.byProperty.find((p) => p.property_id === "WEL")!;
  const ptl = r.byProperty.find((p) => p.property_id === "PTL")!;
  assert.deepEqual([wel.room, wel.safari, wel.transfer, wel.total], [174640, 138600, 18900, 332140]);
  assert.deepEqual([ptl.room, ptl.safari, ptl.transfer, ptl.total], [130980, 86100, 9450, 226530]);
});

test("Early Bird (fixed 15,930 per room-night) matches the sheet: 4,76,070", () => {
  const r = priceTrip({ ...trip, offer_ids: ["EBO"] }, data);
  assert.equal(r.totals.room + r.totals.discount, 223020);
  assert.equal(r.totals.grand, 476070);
  const wel = r.byProperty.find((p) => p.property_id === "WEL")!;
  const ptl = r.byProperty.find((p) => p.property_id === "PTL")!;
  assert.equal(wel.total, 284940); // WEL row of the sheet
  assert.equal(ptl.total, 191130); // PTL row of the sheet
  assert.deepEqual(r.appliedOffers, ["EBO"]);
});

test("20% off rooms matches the sheet: 4,97,546", () => {
  const r = priceTrip({ ...trip, offer_ids: ["P20"] }, data);
  assert.equal(r.totals.room + r.totals.discount, 244496);
  assert.equal(r.totals.grand, 497546);
});

test("offers that cannot combine: only the first is applied", () => {
  const r = priceTrip({ ...trip, offer_ids: ["EBO", "P20"] }, data);
  assert.equal(r.totals.grand, 476070);
  assert.ok(r.warnings.some((w) => w.includes("cannot be combined")));
});

test("stay 4 pay 3 at Waghoba gives one night free", () => {
  const r = priceTrip({ ...trip, offer_ids: ["S4P3"] }, data);
  assert.equal(r.totals.discount, -43660);
});

test("payment schedule merges the past 145-day instalment into the deposit", () => {
  const r = priceTrip(trip, data);
  assert.equal(r.payments.length, 2);
  assert.equal(r.payments[0].pct, 50);
  assert.equal(r.payments[0].due, null);
  assert.equal(r.payments[0].amount, 279335);
  assert.equal(r.payments[1].due, "2026-12-02");
  assert.equal(r.payments[1].amount, 279335);
});

test("booking early keeps all three instalments, amounts add up exactly", () => {
  const p = paymentSchedule(558670, "2027-01-16", "2026-06-01", [
    { label: "Deposit", pct: 25, days_before_arrival: null },
    { label: "Second deposit", pct: 25, days_before_arrival: 145 },
    { label: "Final balance", pct: 50, days_before_arrival: 45 },
  ]);
  assert.deepEqual(p.map((x) => x.due), [null, "2026-08-24", "2026-12-02"]);
  assert.equal(p.reduce((t, x) => t + x.amount, 0), 558670);
});

test("a core safari on Tuesday at Tadoba is reported as closed", () => {
  const r = priceTrip({ ...trip, safaris: both("2027-01-19", "TADOBA", "core") }, data);
  assert.ok(r.errors.some((e) => e.includes("park closed")));
});

test("Pench Wednesday: afternoon closed, morning fine", () => {
  const r = priceTrip({ ...trip, safaris: both("2027-01-20", "PENCH", "core") }, data);
  assert.equal(r.errors.filter((e) => e.includes("park closed")).length, 1);
  assert.ok(r.errors[0].includes("afternoon"));
});

test("missing rate is an error, not a silent zero", () => {
  const r = priceTrip({ ...trip, stays: [{ ...trip.stays[0], check_in: "2027-07-10" }] }, data);
  assert.ok(r.errors.some((e) => e.startsWith("No AP rate")));
});

test("7 guests need two jeeps; 3 adults in 2 rooms = one double + one single", () => {
  assert.deepEqual(occupancy(3, 2), [2, 1]);
  const r = priceTrip({ ...trip, adults: 7, stays: trip.stays.map((s) => ({ ...s, rooms: 4 })) }, data);
  const s = r.lines.find((l) => l.kind === "safari")!;
  assert.equal(s.quantity, 2);
  assert.equal(s.amount, 2 * 26250);
});

test("markup, adjustment and USD", () => {
  const r = priceTrip({ ...trip, markup_pct: 10, adjustment: { amount: -5000, reason: "Repeat guest" }, currency: "USD" }, data);
  assert.equal(r.totals.markup, 55867);
  assert.equal(r.totals.grand, 558670 + 55867 - 5000);
  assert.equal(r.grandInCurrency, Math.round(((558670 + 55867 - 5000) / 84) * 100) / 100);
  const noReason = priceTrip({ ...trip, adjustment: { amount: -5000, reason: " " } }, data);
  assert.ok(noReason.errors.some((e) => e.includes("needs a reason")));
});

test("data check: complete sheet data has no errors; gaps are found", async () => {
  const { checkData } = await import("./health");
  const ok = checkData(data, "2026-10-05");
  assert.equal(ok.filter((i) => i.level === "error").length, 0);
  const broken = checkData({ ...data, roomRates: [], safariRates: [] }, "2026-10-05");
  assert.ok(broken.some((i) => i.message.includes("no room rates")));
  assert.ok(broken.some((i) => i.message.includes("no safari rates")));
});

test("per-person basis: all guests by default, adults only when set", () => {
  const withChild = { ...trip, children: [8] };
  const all = priceTrip(withChild, data);
  assert.equal(all.perPerson, Math.round(all.totals.grand / 3));
  const adults = priceTrip(withChild, { ...data, settings: { ...data.settings, per_person_basis: "adults" } });
  assert.equal(adults.perPerson, Math.round(adults.totals.grand / 2));
});
