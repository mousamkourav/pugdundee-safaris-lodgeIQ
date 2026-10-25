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
  assert.ok(r.missing.some((m) => m.kind === "room" && m.label.includes("AC Cottage")));
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

test("with a child, the price is per adult plus the child's own price (the total is not divided by the child)", () => {
  const withChild = { ...trip, children: [8] };
  const r = priceTrip(withChild, data);
  const s = r.split!;
  assert.equal(r.perPerson, s.adult);
  assert.notEqual(r.perPerson, Math.round(r.totals.grand / 3));
  assert.ok(Math.abs(s.adult * withChild.adults + s.children[0].amount - r.totals.grand) <= withChild.adults + 1); // rounding
  // no children: the same as before
  const plain = priceTrip(trip, data);
  assert.equal(plain.perPerson, Math.round(plain.totals.grand / trip.adults));
});

test("missing rates become 'price needed' items, and typed prices are used", () => {
  const noTransfers = { ...data, transferRates: [] };
  const r = priceTrip(trip, noTransfers);
  assert.equal(r.missing.length, 3);
  assert.ok(r.missing.every((m) => m.kind === "transfer"));
  assert.deepEqual(r.errors, []); // missing prices are not errors
  const prices = Object.fromEntries(r.missing.map((m, i) => [m.key, [7875, 11025, 9450][i]]));
  const r2 = priceTrip({ ...trip, manual_prices: prices }, noTransfers);
  assert.deepEqual(r2.errors, []);
  assert.equal(r2.totals.grand, 558670); // same as with master-data rates
  assert.equal(r2.manualCount, 3);
  assert.equal(r2.missing.length, 3); // still listed, so the typed prices stay editable
});

test("items added by hand are priced and billed to that night's lodge", () => {
  const r = priceTrip({ ...trip, custom_items: [{ date: "2027-01-17", title: "Bush dinner", amount: 8000 }, { date: "2027-01-21", title: "Note only", amount: 0 }] }, data);
  assert.equal(r.totals.addon, 8000);
  assert.equal(r.totals.grand, 558670 + 8000);
  assert.equal(r.byProperty.find((p) => p.property_id === "WEL")!.addon, 8000);
});

import { priceBreakdown } from "./breakdown";

const withNaturalist = {
  ...data,
  addons: [
    { id: "NAT_WEL", name: "Accompanying naturalist", property_id: "WEL", pricing_unit: "per_vehicle" as const, rate: 2500, tax_pct: 5, active: true },
    { id: "NAT_ALL", name: "Accompanying naturalist", property_id: null, pricing_unit: "per_vehicle" as const, rate: 3000, tax_pct: 5, active: true },
  ],
};

test("naturalist is charged per safari, only when ticked", () => {
  const plain = priceTrip(trip, withNaturalist);
  const ticked = priceTrip({ ...trip, safaris: trip.safaris.map((s, i) => (i < 2 ? { ...s, naturalist: true } : s)) }, withNaturalist);
  const nat = ticked.lines.filter((l) => l.group === "naturalist");
  assert.equal(nat.length, 2);
  // 2 rooms of guests fit one jeep: 2,500 + 5% at Waghoba
  assert.ok(nat.every((l) => l.amount === 2625));
  assert.equal(ticked.totals.grand, plain.totals.grand + 2 * 2625);
  // a safari whose lodge has no naturalist add-on uses the general one
  const pench = trip.safaris.findIndex((s) => s.park_id === "PENCH");
  const r = priceTrip({ ...trip, safaris: trip.safaris.map((s, i) => (i === pench ? { ...s, naturalist: true } : s)) }, withNaturalist);
  assert.equal(r.lines.find((l) => l.group === "naturalist")!.amount, 3150);
  // no naturalist rate at all: a price box, not a silent zero
  const none = priceTrip({ ...trip, safaris: [{ ...trip.safaris[0], naturalist: true }] }, data);
  assert.ok(none.missing.some((m) => m.kind === "naturalist"));
});

test("% discount on our lodges' accommodation, or on everything; GST reduced in proportion", () => {
  const base = priceTrip(trip, data);
  const lodges = priceTrip({ ...trip, discount: { pct: 10, scope: "lodges", reason: "Repeat guest" } }, data);
  assert.equal(lodges.totals.grand, base.totals.grand - Math.round(base.totals.room * 0.1));
  const all = priceTrip({ ...trip, discount: { pct: 10, scope: "all", reason: "Group" } }, data);
  assert.equal(all.totals.grand, base.totals.grand - Math.round(base.totals.grand * 0.1));
  const noReason = priceTrip({ ...trip, discount: { pct: 5, scope: "all", reason: "" } }, data);
  assert.ok(noReason.errors.some((e) => e.includes("reason")));
});

test("the price breakup (net + GST) always adds up to the total", () => {
  const cases = [
    priceTrip(trip, data),
    priceTrip({ ...trip, markup_pct: 7, adjustment: { amount: -1999, reason: "rounding" } }, data),
    priceTrip({ ...trip, discount: { pct: 12.5, scope: "all", reason: "x" }, custom_items: [{ date: "2027-01-16", title: "Flight Delhi to Nagpur", amount: 18000, group: "flight" }] }, withNaturalist),
  ];
  // rates entered like the real master data: 18% GST on rooms, 5% on safaris, added on top
  const taxed = {
    ...withNaturalist,
    roomRates: data.roomRates.map((r) => ({ ...r, rate_single: r.rate_single ? Math.round(r.rate_single / 1.18) : r.rate_single, rate_double: r.rate_double ? Math.round(r.rate_double / 1.18) : r.rate_double, tax_pct: 18, rates_include_tax: false })),
    safariRates: data.safariRates.map((r) => ({ ...r, tax_pct: 5 })),
  };
  cases.push(priceTrip({ ...trip, discount: { pct: 10, scope: "lodges", reason: "x" }, safaris: trip.safaris.map((x) => ({ ...x, naturalist: true })) }, taxed));
  cases.push(priceTrip({ ...trip, markup_pct: 5 }, taxed));
  for (const r of cases) {
    const b = priceBreakdown(r);
    assert.equal(b.total, r.totals.grand); // always exact
  }
  const b = priceBreakdown(cases[2]);
  assert.deepEqual(b.rows.map((x) => x.key), ["accommodation", "safaris", "transfers", "flights", "discount", "gst"]);
  const t = priceBreakdown(cases[3]);
  assert.deepEqual(t.rows.map((x) => x.key), ["accommodation", "safaris", "naturalists", "transfers", "discount", "gst"]);
  // GST is 18% of accommodation after the 10% discount (discount lowers the GST too)
  const acc = t.rows.find((x) => x.key === "accommodation")!.amount;
  const safGst = Math.round((t.rows.find((x) => x.key === "safaris")!.amount + t.rows.find((x) => x.key === "naturalists")!.amount) * 0.05);
  assert.ok(Math.abs(t.gst - (Math.round(acc * 0.9 * 0.18) + safGst)) <= 20, `gst ${t.gst}`);
});

test("Tadoba booking-window rates: 4-59 days ahead is cheaper than 60-120", () => {
  const windowed = {
    ...data,
    safariRates: [
      ...data.safariRates,
      ...data.safariRates.filter((r) => r.park_id === "TADOBA" && r.zone === "core").map((r) => ({ ...r, id: r.id + "_late", weekday_rate: 11000, weekend_rate: 12000, book_min_days: 4, book_max_days: 59 })),
    ],
  };
  const sunday = trip.safaris.find((s) => s.park_id === "TADOBA" && s.date === "2027-01-17")!;
  const one = { ...trip, safaris: [sunday] };
  const early = priceTrip({ ...one, booking_date: "2026-10-05" }, windowed); // 104 days ahead: normal rate
  const late = priceTrip({ ...one, booking_date: "2026-12-20" }, windowed); // 28 days ahead: the 4-59 day rate
  const s = (r: ReturnType<typeof priceTrip>) => r.lines.find((l) => l.kind === "safari")!;
  assert.equal(s(late).unit_price, 12000);
  assert.ok(s(early).unit_price > 12000);
});

test("multi-lodge offer: 2 lodges and 6 nights = 10% off rooms; suggested when not ticked", () => {
  const offer = { id: "ML2", name: "Any 2 lodges, 6 nights", offer_type: "multi_lodge" as const, value: 10, stay_nights: null, pay_nights: null, applies_to: ["room"], property_ids: [], room_category_ids: [], book_from: null, book_to: null, travel_from: null, travel_to: null, min_nights: 6, min_lodges: 2, combinable: false, active: true };
  const withOffer = { ...data, offers: [...data.offers, offer] };
  const base = priceTrip(trip, withOffer);
  assert.ok(base.warnings.some((w) => w.includes("qualifies") && w.includes("10% off")));
  const applied = priceTrip({ ...trip, offer_ids: ["ML2"] }, withOffer);
  assert.equal(applied.totals.grand, base.totals.grand - Math.round(base.totals.room * 0.1) + (applied.totals.grand - (base.totals.grand + applied.totals.discount)));
  assert.equal(applied.totals.discount, -base.lines.filter((l) => l.kind === "room").reduce((t, l) => t + Math.round(l.amount * 0.1), 0));
  const oneLodge = priceTrip({ ...trip, stays: [trip.stays[0]], offer_ids: ["ML2"] }, withOffer);
  assert.ok(oneLodge.warnings.some((w) => w.includes("needs 2 of our lodges")));
  assert.equal(oneLodge.totals.discount, 0);
});

test("transfers: a rate entered only the other way round is used; a chosen vehicle without a rate falls back", () => {
  const oneWay = { ...data, transferRates: data.transferRates.map((r) => ({ ...r, bidirectional: false })) };
  const t0 = trip.transfers[trip.transfers.length - 1]; // Pench to Nagpur in the sheet
  const reversed = { ...trip, transfers: [{ ...t0, from_location_id: t0.to_location_id, to_location_id: t0.from_location_id }] };
  const r = priceTrip(reversed, oneWay);
  assert.equal(r.missing.length, 0);
  assert.ok(r.lines.find((l) => l.kind === "transfer")!.amount > 0);
  const odd = priceTrip({ ...trip, transfers: trip.transfers.map((t) => ({ ...t, vehicle_type: "AC Innova" })) }, data);
  assert.equal(odd.missing.length, 0);
  assert.ok(odd.warnings.some((w) => w.includes("No AC Innova rate")));
});
