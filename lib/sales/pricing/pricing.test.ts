// Checks the pricing engine against the Tadoba - Pench costing sheet.
// Run with:  npx tsx --test lib/sales/pricing/pricing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip, paymentSchedule, occupancy } from "./engine";
import type { PricingData, TripInput, SafariRate, Offer } from "./types";

const safari = (id: string, park: string, zone: "core" | "buffer", session: "morning" | "afternoon", weekend: number | null): SafariRate => ({
  id, park_id: park, zone, vehicle_type: "exclusive_jeep", session, pricing_unit: "per_vehicle", nationality: "all",
  valid_from: "2026-10-01", valid_to: "2027-06-30", weekday_rate: 21525, weekend_rate: weekend, weekend_days: weekend ? [0] : [],
  max_pax: 6, naturalist_fee: 0, guide_fee: 0, tax_pct: 0, active: true,
});

const offer = (o: Partial<Offer> & Pick<Offer, "id" | "name" | "offer_type">): Offer => ({
  value: null, stay_nights: null, pay_nights: null, applies_to: ["room"], property_ids: [], room_category_ids: [],
  book_from: null, book_to: null, travel_from: null, travel_to: null, min_nights: 1, combinable: false, active: true, ...o,
});

// Master data that reproduces the sheet. Room 43,660 a night for two AC
// cottages with one guest each = 21,830 single occupancy per room.
const data: PricingData = {
  properties: [
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TADOBA" },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PENCH" },
  ],
  rooms: [
    { id: "WEL_AC", property_id: "WEL", name: "AC Cottage", max_adults: 2, max_children: 1, extra_bed: false },
    { id: "PTL_AC", property_id: "PTL", name: "AC Cottage", max_adults: 2, max_children: 1, extra_bed: false },
  ],
  roomRates: ["WEL_AC", "PTL_AC"].map((room) => ({
    id: room + "_R", room_category_id: room, valid_from: "2026-10-01", valid_to: "2027-06-30", meal_plan: "AP",
    rate_single: 21830, rate_double: 26000, extra_adult: 6000, child_rates: [], weekend_days: [],
    weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 0, rates_include_tax: true, active: true,
  })),
  parks: [
    { id: "TADOBA", name: "Tadoba" },
    { id: "PENCH", name: "Pench" },
  ],
  closures: [
    { park_id: "TADOBA", zone: "core", closure_type: "weekly", weekday: 2, session: "full_day", date_from: null, date_to: null, label: "Tuesday core closure" },
    { park_id: "PENCH", zone: "core", closure_type: "weekly", weekday: 3, session: "afternoon", date_from: null, date_to: null, label: "Wednesday afternoon" },
  ],
  safariRates: [
    safari("T_CM", "TADOBA", "core", "morning", 26250),
    safari("T_CA", "TADOBA", "core", "afternoon", 26250),
    safari("T_BM", "TADOBA", "buffer", "morning", null),
    safari("T_BA", "TADOBA", "buffer", "afternoon", null),
    safari("P_CM", "PENCH", "core", "morning", 26250),
    safari("P_CA", "PENCH", "core", "afternoon", 26250),
  ],
  locations: [
    { id: "NAG", name: "Nagpur Airport", property_id: null },
    { id: "L_WEL", name: "Waghoba Eco Lodge", property_id: "WEL" },
    { id: "L_PTL", name: "Pench Tree Lodge", property_id: "PTL" },
  ],
  transferRates: [
    { id: "TR1", from_location_id: "NAG", to_location_id: "L_WEL", vehicle_type: "Innova", capacity: 4, rate: 7875, drive_hours: 2.5, night_surcharge: 1200, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true },
    { id: "TR2", from_location_id: "L_WEL", to_location_id: "L_PTL", vehicle_type: "Innova", capacity: 4, rate: 11025, drive_hours: 5, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true },
    // stored as Nagpur -> Pench; the trip uses it in reverse (same rate for return)
    { id: "TR3", from_location_id: "NAG", to_location_id: "L_PTL", vehicle_type: "Innova", capacity: 4, rate: 9450, drive_hours: 4, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true },
  ],
  addons: [],
  offers: [
    offer({ id: "EBO", name: "Early Bird Offer", offer_type: "fixed_rate", value: 15930 }),
    offer({ id: "P20", name: "20% off rooms", offer_type: "percent", value: 20 }),
    offer({ id: "S4P3", name: "Stay 4 pay 3", offer_type: "stay_pay", stay_nights: 4, pay_nights: 3, property_ids: ["WEL"] }),
  ],
  settings: { markup_pct: 0, fx: { USD: 84 }, payment_slabs: null },
};

const both = (date: string, park: string, zone: "core" | "buffer") => [
  { date, park_id: park, zone, session: "morning" as const },
  { date, park_id: park, zone, session: "afternoon" as const },
];

// The trip exactly as in the sheet: 16 - 23 Jan 2027, 2 guests, 2 cottages.
const trip: TripInput = {
  adults: 2,
  children: [],
  nationality: "foreign",
  stays: [
    { property_id: "WEL", room_category_id: "WEL_AC", meal_plan: "AP", check_in: "2027-01-16", nights: 4, rooms: 2 },
    { property_id: "PTL", room_category_id: "PTL_AC", meal_plan: "AP", check_in: "2027-01-20", nights: 3, rooms: 2 },
  ],
  safaris: [
    ...both("2027-01-17", "TADOBA", "core"), // Sunday: 52,500
    ...both("2027-01-18", "TADOBA", "core"), // 43,050
    ...both("2027-01-19", "TADOBA", "buffer"), // Tuesday, core closed
    ...both("2027-01-21", "PENCH", "core"),
    ...both("2027-01-22", "PENCH", "core"),
  ],
  transfers: [
    { date: "2027-01-16", from_location_id: "NAG", to_location_id: "L_WEL" },
    { date: "2027-01-20", from_location_id: "L_WEL", to_location_id: "L_PTL" },
    { date: "2027-01-23", from_location_id: "L_PTL", to_location_id: "NAG" },
  ],
  booking_date: "2026-10-05",
};

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
