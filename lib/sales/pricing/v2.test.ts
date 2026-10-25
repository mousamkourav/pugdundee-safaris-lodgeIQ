// The itinerary fixes of October 2026: dates not fixed, yearly hike, manual rate of
// exchange, one GST rate on the package, prices corrected by hand, jeeps per
// safari, add-on rules, payment schedule without dates.
// Run with:  npx tsx --test lib/sales/pricing/v2.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip, paymentSchedule, seasonOfRate } from "./engine";
import { detailedBreakdown, priceBreakdown } from "./breakdown";
import { data, trip } from "./sheet-fixture";
import type { PricingData, RoomRate, TripInput } from "./types";

const rate = (id: string, from: string, to: string, double: number, notes: string | null): RoomRate => ({
  id, room_category_id: "KL_AC", valid_from: from, valid_to: to, meal_plan: "AP", rate_single: null, rate_double: double, extra_adult: null,
  child_rates: [], weekend_days: [], weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 18, rates_include_tax: false, active: true, notes,
});

// Kings Lodge style seasons: shoulder 18,000, high 22,000, peak 23,000 (+18% GST).
const seasons: PricingData = {
  ...data,
  properties: [{ id: "KL", name: "Kings Lodge", park_id: "BAN" }],
  rooms: [{ id: "KL_AC", property_id: "KL", name: "AC Deluxe Cottage", max_adults: 2, max_children: 2, extra_bed: true }],
  roomRates: [
    rate("S1", "2026-10-01", "2026-10-16", 18000, "Shoulder. Extra adult 40%"),
    rate("P1", "2026-10-17", "2026-10-20", 23000, "Peak - Dussehra long weekend"),
    rate("H1", "2026-11-01", "2026-11-05", 22000, "High."),
    rate("S2", "2027-01-05", "2027-01-31", 18000, "Shoulder."),
  ],
  parks: [{ id: "BAN", name: "Bandhavgarh" }],
  closures: [],
  safariRates: [],
  transferRates: [],
  offers: [],
};
const stay = (check_in: string, nights = 1): TripInput => ({
  adults: 2,
  children: [],
  nationality: "foreign",
  stays: [{ property_id: "KL", room_category_id: "KL_AC", meal_plan: "AP", check_in, nights, rooms: 1 }],
  safaris: [],
  transfers: [],
  booking_date: "2026-10-05",
});

test("season of a rate: from its note, else by price", () => {
  assert.equal(seasonOfRate(seasons.roomRates[0], seasons.roomRates), "shoulder");
  assert.equal(seasonOfRate(seasons.roomRates[1], seasons.roomRates), "peak");
  assert.equal(seasonOfRate(seasons.roomRates[2], seasons.roomRates), "high");
  const noNotes = seasons.roomRates.map((r) => ({ ...r, notes: null }));
  assert.equal(seasonOfRate(noNotes[0], noNotes), "shoulder");
  assert.equal(seasonOfRate(noNotes[1], noNotes), "peak");
  assert.equal(seasonOfRate(noNotes[2], noNotes), "high");
});

test("dates not fixed: the chosen season's rate, whatever the placeholder date", () => {
  const price = (season: "shoulder" | "high" | "peak") =>
    priceTrip({ ...stay("2030-01-01"), rate_basis: { season, safari_days: "weekday", year: "current" } }, seasons).totals.room;
  assert.equal(price("shoulder"), 21240); // 18,000 + 18%
  assert.equal(price("high"), 25960);
  assert.equal(price("peak"), 27140);
  const r = priceTrip({ ...stay("2030-01-01"), rate_basis: { season: "high", safari_days: "weekday", year: "current" } }, seasons);
  assert.equal(r.dateless, true);
  assert.deepEqual(r.missing, []);
});

test("yearly hike: a date after the rates end uses last year's rate + hike", () => {
  const hiked: PricingData = { ...seasons, settings: { ...seasons.settings, hike: { label: "2027-28", from: "2027-07-01", to: "2028-06-30", hotels_pct: 10, safaris_pct: 0, transfers_pct: 0 } } };
  const r = priceTrip(stay("2028-01-10"), hiked); // 2027-01-10 was shoulder 18,000
  assert.equal(r.totals.room, Math.round(18000 * 1.1 * 1.18));
  assert.ok(r.lines[0].description.includes("2027-28"));
  assert.ok(r.warnings.some((w) => w.includes("2027-28")));
  // without a hike the rate is missing
  assert.equal(priceTrip(stay("2028-01-10"), seasons).missing.length, 1);
});

test("dates not fixed + next season: this season's rate + hike", () => {
  const hiked: PricingData = { ...seasons, settings: { ...seasons.settings, hike: { label: "2027-28", from: "2027-07-01", to: "2028-06-30", hotels_pct: 10, safaris_pct: 0, transfers_pct: 0 } } };
  const r = priceTrip({ ...stay("2030-01-01"), rate_basis: { season: "shoulder", safari_days: "weekday", year: "next" } }, hiked);
  assert.equal(r.totals.room, Math.round(18000 * 1.1 * 1.18));
});

test("manual rate of exchange is used as typed", () => {
  const r = priceTrip({ ...trip, currency: "USD", fx_rate: 90 }, data);
  assert.equal(r.fx, 90);
  assert.equal(r.grandInCurrency, Math.round((r.totals.grand / 90) * 100) / 100);
});

test("one GST rate on the package: services before GST, one GST line", () => {
  const item = priceTrip(stay("2026-10-05"), seasons);
  assert.equal(item.totals.grand, 21240);
  const pkg = priceTrip({ ...stay("2026-10-05"), gst: { mode: "consolidated", pct: 5 } }, seasons);
  assert.equal(pkg.totals.tax, 900);
  assert.equal(pkg.totals.grand, 18900);
  const b = priceBreakdown(pkg);
  assert.equal(b.gst, 900);
  assert.equal(b.rows.find((x) => x.key === "gst")!.label, "GST 5% on the package");
});

test("a price corrected by hand replaces the line, GST worked out again", () => {
  const first = priceTrip(stay("2026-10-05"), seasons);
  const key = first.lines[0].lkey!;
  const r = priceTrip({ ...stay("2026-10-05"), line_prices: { [key]: 23600 } }, seasons);
  assert.equal(r.totals.grand, 23600);
  assert.equal(r.lines[0].tax, 3600); // 20,000 + 18%
  assert.equal(r.lines[0].edited, true);
  const d = detailedBreakdown(r).rows[0];
  assert.equal(d.net, 20000);
  assert.equal(d.gstPct, 18);
});

test("jeeps per safari: 4 guests in 2 jeeps costs two jeeps", () => {
  const one = priceTrip({ ...trip, safaris: [{ date: "2027-01-18", park_id: "TADOBA", zone: "core", session: "morning" }] }, data);
  const two = priceTrip({ ...trip, safaris: [{ date: "2027-01-18", park_id: "TADOBA", zone: "core", session: "morning", vehicles: 2 }] }, data);
  assert.equal(two.totals.safari, one.totals.safari * 2);
  assert.ok(two.lines.find((l) => l.kind === "safari")!.description.includes("2 jeeps"));
});

test("add-ons: minimum guests, guests included + each extra guest, closed weekday", () => {
  const withAddons: PricingData = {
    ...data,
    addons: [
      { id: "WALK", name: "Walking safari in buffer zone", property_id: null, pricing_unit: "per_person", rate: 3000, tax_pct: 0, active: true, min_guests: 2 },
      { id: "BOAT", name: "Boat cruise (Tawa Dam)", property_id: null, pricing_unit: "per_group", rate: 18000, tax_pct: 0, active: true, included_guests: 2, extra_guest_rate: 1500, unavailable_weekdays: [3], availability_note: "Closed on Wednesday evenings" },
    ],
  };
  const solo: TripInput = { ...trip, adults: 1, stays: trip.stays.map((s) => ({ ...s, rooms: 1 })), safaris: [], transfers: [], addons: [{ addon_id: "WALK", date: "2027-01-18" }] };
  assert.equal(priceTrip(solo, withAddons).totals.addon, 6000); // charged for 2
  const family: TripInput = { ...trip, adults: 2, children: [8, 3], safaris: [], transfers: [], addons: [{ addon_id: "BOAT", date: "2027-01-20" }] };
  const r = priceTrip(family, withAddons);
  assert.equal(r.totals.addon, 18000 + 1500); // the 8-year-old pays, the 3-year-old does not
  assert.ok(r.warnings.some((w) => w.includes("Closed on Wednesday evenings"))); // 20 Jan 2027 is a Wednesday
});

test("payment schedule without dates: each instalment as days before arrival", () => {
  const p = paymentSchedule(100000, null, "2026-10-05", [
    { label: "Deposit", pct: 50, days_before_arrival: null },
    { label: "Balance", pct: 50, days_before_arrival: 45 },
  ]);
  assert.equal(p.length, 2);
  assert.equal(p[1].note, "45 days before arrival");
  assert.equal(p[0].amount + p[1].amount, 100000);
});

test("dates not fixed: no closure errors (the weekday is unknown)", () => {
  // 19 Jan 2027 is a Tuesday: Tadoba core is closed, unless the dates are not fixed
  const s: TripInput = { ...trip, safaris: [{ date: "2027-01-19", park_id: "TADOBA", zone: "core", session: "morning" }] };
  assert.ok(priceTrip(s, data).errors.some((e) => e.includes("park closed")));
  assert.deepEqual(priceTrip({ ...s, rate_basis: { season: "high", safari_days: "weekday", year: "current" } }, data).errors, []);
});

test("yearly hike on add-ons: dates in the hike period get the add-ons %", () => {
  const withAddon: PricingData = {
    ...data,
    addons: [{ id: "WALK", name: "Village walk", property_id: null, pricing_unit: "per_person", rate: 1000, tax_pct: 0, active: true }],
    settings: { ...data.settings, hike: { label: "2027-28", from: "2027-07-01", to: "2028-06-30", hotels_pct: 0, safaris_pct: 0, transfers_pct: 0, addons_pct: 10 } },
  };
  const base: TripInput = { ...trip, safaris: [], transfers: [], addons: [{ addon_id: "WALK", date: "2027-01-18" }] };
  assert.equal(priceTrip(base, withAddon).totals.addon, 2000); // before the hike period
  const later = priceTrip({ ...base, addons: [{ addon_id: "WALK", date: "2027-08-10" }] }, withAddon);
  assert.equal(later.totals.addon, 2200);
  assert.ok(later.warnings.some((w) => w.includes("add-ons +10%")));
  // dates not fixed, next season
  const free = priceTrip({ ...base, rate_basis: { season: "high", safari_days: "weekday", year: "next" } }, withAddon);
  assert.equal(free.totals.addon, 2200);
});

test("a child with no child rate for their age is flagged, not silently free", () => {
  const withKid = (child_rates: RoomRate["child_rates"]): PricingData => ({ ...seasons, roomRates: [{ ...seasons.roomRates[0], child_rates }] });
  const kid = (age: number): TripInput => ({ ...stay("2026-10-05", 2), children: [age] });
  const none = priceTrip(kid(8), withKid([]));
  assert.equal(none.totals.room, 42480); // 2 nights x 18,000 + 18%: the child adds nothing
  assert.equal(none.warnings.filter((w) => w.includes("age 8")).length, 1); // one warning, not one per night
  const banded = withKid([{ min_age: 0, max_age: 4, rate: 0 }, { min_age: 5, max_age: 11, rate: 3000 }]);
  const priced = priceTrip(kid(8), banded);
  assert.equal(priced.totals.room, 49560); // + 2 x 3,000 + 18%
  assert.ok(!priced.warnings.some((w) => w.includes("child rate")));
  // a band at 0 (infants free) is a price, so no warning
  assert.ok(!priceTrip(kid(3), banded).warnings.some((w) => w.includes("child rate")));
  // an infant (under 5) with no band is free on purpose: no warning either
  assert.ok(!priceTrip(kid(3), withKid([])).warnings.some((w) => w.includes("child rate")));
  // the per-guest split agrees: the unbanded 8-year-old's room share is 0, the banded one's is not
  assert.ok((none.split?.children[0].amount ?? 0) < (priced.split?.children[0].amount ?? 0));
});

test("yearly hike on transfers: only when no rate covers the date (like rooms and safaris)", () => {
  const road = { id: "T1", from_location_id: "JLR", to_location_id: "KL", vehicle_type: "Innova", capacity: 4, rate: 7000, drive_hours: 4, night_surcharge: 0, bidirectional: true, tax_pct: 0, active: true };
  const withRoad = (valid_to: string | null): PricingData => ({
    ...seasons,
    transferRates: [{ ...road, valid_from: "2026-04-01", valid_to }],
    settings: { ...seasons.settings, hike: { label: "2027-28", from: "2027-07-01", to: "2028-06-30", hotels_pct: 0, safaris_pct: 0, transfers_pct: 10 } },
  });
  const drive = (date: string): TripInput => ({ ...stay("2027-01-10"), stays: [], transfers: [{ date, from_location_id: "JLR", to_location_id: "KL" }] });
  // the 2026-27 rate runs to 30 Sep 2027: August 2027 is covered, no hike
  const covered = priceTrip(drive("2027-08-10"), withRoad("2027-09-30"));
  assert.equal(covered.totals.transfer, 7000);
  assert.ok(!covered.warnings.some((w) => w.includes("transfers +10%")));
  // October 2027: no rate covers it, so last year's rate + 10%
  const after = priceTrip(drive("2027-10-15"), withRoad("2027-09-30"));
  assert.equal(after.totals.transfer, 7700);
  assert.deepEqual(after.missing, []);
  // a rate with no end date covers every later date: no hike
  assert.equal(priceTrip(drive("2027-10-15"), withRoad(null)).totals.transfer, 7000);
  // dates not fixed, next season: this season's rate + hike
  assert.equal(priceTrip({ ...drive("2030-01-01"), rate_basis: { season: "high", safari_days: "weekday", year: "next" } }, withRoad("2027-09-30")).totals.transfer, 7700);
});

test("per jeep add-ons: one for each jeep that day, else enough jeeps for the group", () => {
  const withAddon: PricingData = { ...data, addons: [{ id: "BF", name: "Safari breakfast", property_id: null, pricing_unit: "per_vehicle", rate: 1000, tax_pct: 18, active: true }] };
  const line = (t: TripInput) => priceTrip(t, withAddon).lines.find((l) => l.kind === "addon")!;
  const two: TripInput = { ...trip, adults: 2, children: [], transfers: [], safaris: [], addons: [{ addon_id: "BF", date: "2027-01-18" }] };
  assert.deepEqual([line(two).quantity, line(two).amount], [1, 1180]);
  const eight: TripInput = { ...two, adults: 8, stays: two.stays.map((s) => ({ ...s, rooms: 4 })) };
  assert.equal(line(eight).quantity, 2);
  const s0 = trip.safaris[0];
  const set: TripInput = { ...two, adults: 4, safaris: [{ ...s0, date: "2027-01-18", vehicles: 3 }] };
  assert.equal(line(set).quantity, 3);
});

test("price per guest: adults, the extra adult, a child and an infant; the shares add up to the total", () => {
  const kids: PricingData = {
    ...seasons,
    roomRates: [{ ...rate("K1", "2027-01-01", "2027-03-31", 20000, "High."), extra_adult: 6000, child_rates: [{ min_age: 5, max_age: 12, rate: 4000 }], tax_pct: 0 }],
    addons: [{ id: "WALK", name: "Village walk", property_id: null, pricing_unit: "per_person", rate: 1000, tax_pct: 0, active: true }],
  };
  const t: TripInput = { ...stay("2027-01-10", 2), adults: 3, children: [8, 2], addons: [{ addon_id: "WALK", date: "2027-01-10" }] };
  const r = priceTrip(t, kids);
  const s = r.split!;
  // room: 2 nights x (20,000 twin + 6,000 extra bed + 4,000 child) = 60,000; walk: 5 x 1,000
  assert.equal(r.totals.grand, 65000);
  assert.equal(s.extra_adults, 1);
  assert.equal(s.adult, 20000 + 1000); // 40,000 for the two sharing adults, plus the walk
  assert.equal(s.extra_adult, 12000 + 1000);
  assert.deepEqual(s.children, [{ age: 8, amount: 8000 + 1000, infant: false }, { age: 2, amount: 1000, infant: true }]);
  assert.equal(s.adult * 2 + s.extra_adult! + s.children.reduce((x, c) => x + c.amount, 0), r.totals.grand);
  // "per person" is now per adult, not the total divided by the children too
  assert.equal(r.perPerson, s.adult);
});
