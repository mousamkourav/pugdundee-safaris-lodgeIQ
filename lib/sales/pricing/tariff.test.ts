// Run with:  npx tsx --test lib/sales/pricing/tariff.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileTariff, type TariffRow } from "./tariff";
import { priceTrip } from "./engine";
import { data, trip } from "./sheet-fixture";
import type { Addon } from "./types";

const base: Omit<TariffRow, "id" | "nationality" | "season" | "rate_single" | "rate_double"> = {
  rate_category_id: "COT", valid_from: "2026-10-01", valid_to: "2027-06-30", meal_plan: "AP", weekend_rate_single: null, weekend_rate_double: null,
  weekend_days: [], extra_adult_pct: 40, child_free_under: 5, child_5_12_pct: 25, child_13_17_pct: 40, min_nights: 2, tax_pct: 18, rates_include_tax: false,
};
const tariff: TariffRow[] = [
  { ...base, id: "I", nationality: "indian", season: "all", rate_single: 27000, rate_double: 30000, valid_to: "2027-09-30" },
  { ...base, id: "FS", nationality: "foreign", season: "shoulder", rate_single: 15000, rate_double: 18000 },
  { ...base, id: "FH", nationality: "foreign", season: "high", rate_single: 18500, rate_double: 22000 },
  { ...base, id: "FP", nationality: "foreign", season: "peak", rate_single: 20000, rate_double: 23000 },
];
const calendar = [
  { calendar: "pugdundee", season: "shoulder" as const, date_from: "2027-01-05", date_to: "2027-01-31" },
  { calendar: "pugdundee", season: "high" as const, date_from: "2026-11-01", date_to: "2026-11-30" },
  { calendar: "pugdundee", season: "peak" as const, date_from: "2026-11-06", date_to: "2026-11-14" }, // Diwali long weekend inside High
];
// every room in the fixture is a Cottage
const rooms = data.rooms.map((r) => ({ id: r.id, rate_category_id: "COT" }));
const withTariff = { ...data, roomRates: compileTariff(tariff, calendar, [{ id: "COT", calendar: "pugdundee" }], rooms) };
const roomNight = (nat: "indian" | "foreign", date: string) => {
  const stay = { ...trip.stays[0], check_in: date, nights: 1, rooms: 1 };
  const r = priceTrip({ ...trip, nationality: nat, stays: [stay], safaris: [], transfers: [], addons: [] }, withTariff);
  return r.lines.find((l) => l.kind === "room")!.unit_price;
};

test("one tariff for every Cottage: foreigners by season, Indians the published rate", () => {
  assert.equal(roomNight("foreign", "2027-01-16"), 18000); // shoulder
  assert.equal(roomNight("foreign", "2026-11-20"), 22000); // high
  assert.equal(roomNight("foreign", "2026-11-08"), 23000); // Diwali long weekend beats High
  assert.equal(roomNight("indian", "2027-01-16"), 30000);
  assert.equal(roomNight("indian", "2026-11-08"), 30000);
  // extra adult 40% and children 25% / 40% of the double, first child under 5 free
  const r = withTariff.roomRates.find((x) => x.id.startsWith("tariff:I:"))!;
  assert.equal(r.extra_adult, 12000);
  assert.deepEqual(r.child_rates, [{ min_age: 0, max_age: 4, rate: 0 }, { min_age: 5, max_age: 12, rate: 7500 }, { min_age: 13, max_age: 17, rate: 12000 }]);
});

test("a lodge exception still wins over the tariff", () => {
  const room = data.rooms[0].id;
  const exc = { ...withTariff.roomRates.find((x) => x.room_category_id === room)!, id: "EXC", valid_from: "2027-01-01", valid_to: "2027-01-31", rate_double: 9999, nationality: "all" as const, priority: 10 };
  const d = { ...withTariff, roomRates: [...withTariff.roomRates, exc] };
  const stay = { ...trip.stays[0], room_category_id: room, check_in: "2027-01-16", nights: 1, rooms: 1 };
  const r = priceTrip({ ...trip, nationality: "indian", stays: [stay], safaris: [], transfers: [], addons: [] }, d);
  assert.equal(r.lines.find((l) => l.kind === "room")!.unit_price, 9999);
});

test("Ken River style: weekday / weekend in one row, long weekends on top", () => {
  const krl: TariffRow[] = [
    { ...base, id: "K", nationality: "all", season: "all", rate_single: 16500, rate_double: 16500, weekend_rate_single: 17500, weekend_rate_double: 17500, weekend_days: [0, 6], rates_include_tax: true, extra_adult_pct: 0 },
    { ...base, id: "KP", nationality: "all", season: "peak", rate_single: 18500, rate_double: 18500, rates_include_tax: true, extra_adult_pct: 0 },
  ];
  const cal = [{ calendar: "krl", season: "peak" as const, date_from: "2026-12-21", date_to: "2027-01-04" }];
  const d = { ...data, roomRates: compileTariff(krl, cal, [{ id: "COT", calendar: "krl" }], rooms) };
  const night = (date: string) => {
    const r = priceTrip({ ...trip, nationality: "foreign", stays: [{ ...trip.stays[0], check_in: date, nights: 1, rooms: 1 }], safaris: [], transfers: [], addons: [] }, d);
    return r.lines.find((l) => l.kind === "room")!.amount;
  };
  assert.equal(night("2027-01-13"), 16500); // Wednesday
  assert.equal(night("2027-01-16"), 17500); // Saturday
  assert.equal(night("2026-12-25"), 18500); // Christmas long weekend
});

const addon = (a: Partial<Addon>): Addon => ({ id: "A", name: "X", property_id: null, pricing_unit: "per_group", rate: 0, tax_pct: 0, active: true, ...a });
// one experience on the first day, for a group of this size and nationality
const extra = (a: Addon, adults: number, nationality: "indian" | "foreign") => {
  const r = priceTrip({ ...trip, adults, children: [], nationality, safaris: [], transfers: [], addons: [{ addon_id: a.id, date: trip.stays[0].check_in }] }, { ...data, addons: [a] });
  return { amount: r.lines.find((l) => l.kind === "addon")!.amount, warnings: r.warnings };
};

test("experiences: Tawa cruise, boat safari by group size, minimum guests", () => {
  const tawa = addon({ name: "Tawa cruise", rate: 16000, rate_foreign: 20000, included_guests: 2, extra_guest_rate: 750, extra_guest_rate_foreign: 1500, max_guests: 8 });
  assert.equal(extra(tawa, 2, "foreign").amount, 20000);
  assert.equal(extra(tawa, 5, "foreign").amount, 24500); // 20000 + 3 x 1500
  assert.equal(extra(tawa, 5, "indian").amount, 18250); // 16000 + 3 x 750
  assert.ok(extra(tawa, 9, "indian").warnings.some((w) => w.includes("up to 8")));
  const boat = addon({ name: "Boat safari", rate: 10000, included_guests: 2, extra_guest_rate: 750, tiers_foreign: [{ max_guests: 2, rate: 14000 }, { max_guests: 4, rate: 16000 }, { max_guests: 6, rate: 19000 }] });
  assert.equal(extra(boat, 3, "foreign").amount, 16000);
  assert.equal(extra(boat, 6, "foreign").amount, 19000);
  assert.equal(extra(boat, 3, "indian").amount, 10750);
  const banjar = addon({ name: "Banjar River picnic", pricing_unit: "per_person", rate: 2000, min_guests: 2 });
  assert.equal(extra(banjar, 1, "indian").amount, 4000);
});

test("weekend safari rates also on 23 Dec - 2 Jan", () => {
  const s = trip.safaris[0];
  const rate = data.safariRates.find((r) => r.park_id === s.park_id && r.zone === s.zone && r.session === s.session)!;
  if (rate.weekend_rate == null) return; // the fixture park has no weekend rate: nothing to check
  const d = { ...data, settings: { ...data.settings, safari_weekend_ranges: [{ from: "12-23", to: "01-02" }] } };
  const wed = { ...s, date: "2026-12-30" }; // a Wednesday inside the range
  const r = priceTrip({ ...trip, safaris: [wed], stays: trip.stays, transfers: [], addons: [] }, d);
  assert.equal(r.lines.find((l) => l.kind === "safari")!.unit_price, rate.weekend_rate);
});
