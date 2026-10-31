// Run with:  npx tsx --test lib/sales/pricing/windows.test.ts
// Safari rates with booking windows (Tadoba: 4-59 and 60-120 days before the safari).
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip } from "./engine";
import type { PricingData, SafariRate, TripInput } from "./types";

const rate = (id: string, nationality: SafariRate["nationality"], min: number, max: number, amount: number): SafariRate => ({
  id, park_id: "TAD", zone: "core", vehicle_type: "exclusive_jeep", session: "morning", pricing_unit: "per_vehicle", nationality,
  valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: amount, weekend_rate: null, weekend_days: [],
  max_pax: 6, naturalist_fee: 0, guide_fee: 0, tax_pct: 0, active: true, book_min_days: min, book_max_days: max,
});

const data: PricingData = {
  properties: [], rooms: [], roomRates: [], parks: [{ id: "TAD", name: "Tadoba" }], closures: [],
  safariRates: [rate("F_EARLY", "foreign", 60, 120, 30000), rate("F_LATE", "foreign", 4, 59, 40000), rate("I_EARLY", "indian", 60, 120, 9000), rate("I_LATE", "indian", 4, 59, 12000)],
  locations: [], transferRates: [], addons: [], offers: [], settings: {},
};

const trip = (date: string, booking: string, nationality: TripInput["nationality"] = "foreign"): TripInput => ({
  adults: 2, children: [], nationality, stays: [], transfers: [], booking_date: booking,
  safaris: [{ date, park_id: "TAD", zone: "core", session: "morning" }],
});
const safari = (t: TripInput) => {
  const r = priceTrip(t, data);
  return { amount: r.lines.find((l) => l.kind === "safari")?.amount ?? 0, missing: r.missing.length, warnings: r.warnings };
};

test("inside a window: that window's rate", () => {
  assert.equal(safari(trip("2027-01-30", "2026-10-31")).amount, 30000); // 91 days
  assert.equal(safari(trip("2026-11-20", "2026-10-31")).amount, 40000); // 20 days
});

test("30 Apr 2027 booked 31 Oct 2026 (181 days, foreign): the 60-120 day rate, with a note", () => {
  const r = safari(trip("2027-04-30", "2026-10-31"));
  assert.equal(r.amount, 30000);
  assert.equal(r.missing, 0);
  assert.ok(r.warnings.some((w) => /more than 120 days ahead: permits are not open yet, so the 60-120 day rate/.test(w)));
});

test("fewer than 4 days ahead: the 4-59 day rate", () => {
  const r = safari(trip("2026-11-02", "2026-10-31"));
  assert.equal(r.amount, 40000);
  assert.ok(r.warnings.some((w) => /fewer than 4 days ahead/.test(w)));
});

test("Indian rates follow the same rule", () => {
  assert.equal(safari(trip("2027-04-30", "2026-10-31", "indian")).amount, 9000);
  assert.equal(safari(trip("2026-11-01", "2026-10-31", "indian")).amount, 12000);
  assert.equal(safari(trip("2026-12-15", "2026-10-31", "indian")).amount, 12000); // 45 days: inside 4-59
});
