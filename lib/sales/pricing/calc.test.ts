// Run with:  npx tsx --test lib/sales/pricing/calc.test.ts
// Every calculation of a mixed trip, worked out by hand (in the comments) and compared
// with the engine: rooms (extra adult, child, weekend, long weekend, Indian vs foreign,
// rates with and without GST), safaris, naturalist, transfer, add-on, flight, discounts,
// offers, markup, adjustment, rounding, per person, payments and currency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip } from "./engine";
import type { Offer, PricingData, RoomRate, TripInput } from "./types";

const room = (id: string, room_category_id: string, o: Partial<RoomRate>): RoomRate => ({
  id, room_category_id, valid_from: "2026-10-01", valid_to: "2027-09-30", meal_plan: "AP", rate_single: null, rate_double: 0,
  extra_adult: null, child_rates: [], weekend_days: [], weekend_rate_single: null, weekend_rate_double: null, min_nights: 1,
  tax_pct: 18, rates_include_tax: false, active: true, nationality: "all", priority: 2, ...o,
});
const KIDS = [{ min_age: 0, max_age: 4, rate: 0 }, { min_age: 5, max_age: 11, rate: 5000 }, { min_age: 12, max_age: 17, rate: 8000 }];

const data: PricingData = {
  properties: [
    { id: "KL", name: "Kings Lodge", park_id: "BAN", kind: "own_lodge" },
    { id: "THH", name: "Tree House Hideaway", park_id: "BAN", kind: "own_lodge" },
    { id: "IORA", name: "Iora Retreat", park_id: "KAZ", kind: "partner_lodge" },
    { id: "ROS", name: "Roseate House", park_id: null, kind: "city_hotel" },
  ],
  rooms: [
    { id: "KL_C", property_id: "KL", name: "Cottage", max_adults: 2, max_children: 1, extra_bed: true },
    { id: "THH_T", property_id: "THH", name: "Tree House", max_adults: 2, max_children: 1, extra_bed: true },
    { id: "IORA_D", property_id: "IORA", name: "Deluxe Room", max_adults: 2, max_children: 1, extra_bed: true },
    { id: "ROS_D", property_id: "ROS", name: "AC Deluxe", max_adults: 2, max_children: 1, extra_bed: true },
  ],
  roomRates: [
    // Kings Lodge: foreign and Indian rates; Fri and Sat are weekend nights; 16 Jan 2027 a long weekend
    room("KL_F", "KL_C", { nationality: "foreign", rate_double: 20000, rate_single: 15000, extra_adult: 6000, child_rates: KIDS, weekend_days: [5, 6], weekend_rate_double: 24000 }),
    room("KL_I", "KL_C", { nationality: "indian", rate_double: 16000, extra_adult: 5000, child_rates: KIDS }),
    room("KL_LW", "KL_C", { valid_from: "2027-01-16", valid_to: "2027-01-16", priority: 3, nationality: "foreign", rate_double: 30000, extra_adult: 6000, child_rates: KIDS }),
    room("THH_F", "THH_T", { rate_double: 10000, extra_adult: 3000, child_rates: KIDS }),
    // Iora Retreat: GST (12%) included in the rate
    room("IORA_R", "IORA_D", { rate_double: 15000, extra_adult: 4000, child_rates: [{ min_age: 5, max_age: 11, rate: 3000 }], tax_pct: 12, rates_include_tax: true }),
    // Roseate House: B&B, + 18% GST, no extra adult or child rate
    room("ROS_R", "ROS_D", { meal_plan: "CP", rate_double: 17000 }),
  ],
  parks: [{ id: "BAN", name: "Bandhavgarh" }, { id: "KAZ", name: "Kaziranga" }],
  closures: [],
  safariRates: (["morning", "afternoon"] as const).map((session) => ({
    id: `BAN_${session}`, park_id: "BAN", zone: "core" as const, vehicle_type: "exclusive_jeep", session, pricing_unit: "per_vehicle" as const,
    nationality: "all" as const, valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: 10000, weekend_rate: 12000, weekend_days: [0, 6],
    max_pax: 6, naturalist_fee: 3000, guide_fee: 500, tax_pct: 5, active: true,
  })),
  locations: [{ id: "JLR", name: "Jabalpur Airport", property_id: null }, { id: "L_KL", name: "Kings Lodge", property_id: "KL" }],
  transferRates: [{ id: "T1", from_location_id: "JLR", to_location_id: "L_KL", vehicle_type: "Innova", capacity: 4, rate: 9000, drive_hours: 4, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 5, active: true }],
  addons: [{ id: "WALK", name: "Nature walk", property_id: "KL", pricing_unit: "per_person", rate: 1500, tax_pct: 5, active: true }],
  offers: [],
  settings: { markup_pct: 0, fx: { USD: 84 }, fx_margin_pct: 2 },
};

// 3 adults and a child of 8 in 1 room, foreign, booked 31 Oct 2026
const trip = (o: Partial<TripInput> = {}): TripInput => ({
  adults: 3, children: [8], nationality: "foreign", booking_date: "2026-10-31",
  stays: [
    { property_id: "ROS", room_category_id: "ROS_D", meal_plan: "CP", check_in: "2027-01-13", nights: 1, rooms: 1, outside: true },
    { property_id: "KL", room_category_id: "KL_C", meal_plan: "AP", check_in: "2027-01-14", nights: 3, rooms: 1 },
    { property_id: "IORA", room_category_id: "IORA_D", meal_plan: "AP", check_in: "2027-01-17", nights: 2, rooms: 1 },
  ],
  safaris: [
    { date: "2027-01-15", park_id: "BAN", zone: "core", session: "morning" },
    { date: "2027-01-16", park_id: "BAN", zone: "core", session: "afternoon", naturalist: true },
  ],
  transfers: [{ date: "2027-01-14", from_location_id: "JLR", to_location_id: "L_KL" }],
  addons: [{ addon_id: "WALK", date: "2027-01-15" }],
  custom_items: [{ date: "2027-01-17", title: "Flight Delhi to Jorhat", amount: 12000, group: "flight" }],
  ...o,
});
const amounts = (r: ReturnType<typeof priceTrip>, kind: string) => r.lines.filter((l) => l.kind === kind).map((l) => [l.date, l.amount, l.tax]);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---- by hand
// Roseate 13 Jan: 17,000 (3rd adult and the child: no rate, 0) + 18% 3,060 = 20,060
// Kings Lodge (foreign rate, 3 adults in 1 room = double + 1 extra adult, child 8 = 5,000):
//   14 Jan Thu: 20,000 + 6,000 + 5,000 = 31,000 + 18% 5,580 = 36,580
//   15 Jan Fri (weekend): 24,000 + 6,000 + 5,000 = 35,000 + 6,300 = 41,300
//   16 Jan Sat (long weekend rate wins): 30,000 + 6,000 + 5,000 = 41,000 + 7,380 = 48,380
// Iora (GST 12% inside): 15,000 + 4,000 + 3,000 = 22,000 a night, GST in it 2,357; 2 nights 44,000
const ROOMS = 20060 + 36580 + 41300 + 48380 + 44000; // 190,320
// Safaris (4 guests, 1 jeep): 15 Jan Fri weekday 10,000 + guide 500 = 10,500 + 5% 525 = 11,025
//   16 Jan Sat weekend 12,000 + 500 = 12,500 + 625 = 13,125; naturalist 3,000 + 150 = 3,150
const SAFARIS = 11025 + 13125 + 3150; // 27,300
const TRANSFER = 9450; // 9,000 + 5%
const WALK = 6300; // 1,500 x 4 guests + 5%
const FLIGHT = 12000;
const TOTAL = ROOMS + SAFARIS + TRANSFER + WALK + FLIGHT; // 245,370
const TAX = 3060 + 5580 + 6300 + 7380 + 2 * 2357 + 525 + 625 + 150 + 450 + 300; // 29,084

test("rooms: extra adult, child, weekend, long weekend, foreign rate, GST added or included", () => {
  const r = priceTrip(trip(), data);
  assert.deepEqual(amounts(r, "room"), [
    ["2027-01-13", 20060, 3060],
    ["2027-01-14", 36580, 5580],
    ["2027-01-15", 41300, 6300],
    ["2027-01-16", 48380, 7380],
    ["2027-01-17", 22000, 2357],
    ["2027-01-18", 22000, 2357],
  ]);
  // an Indian guest gets the Indian rate: 16,000 + 5,000 + 5,000 = 26,000 + 18% = 30,680
  const indian = priceTrip(trip({ nationality: "indian" }), data);
  assert.equal(indian.lines.find((l) => l.kind === "room" && l.date === "2027-01-14")?.amount, 30680);
  // the Roseate House child has no rate: said, not guessed
  assert.ok(r.warnings.some((w) => /Roseate House: no child rate for age 8/.test(w)));
});

test("safaris, naturalist, transfer, add-on and flight; the total and GST add up", () => {
  const r = priceTrip(trip(), data);
  assert.deepEqual(amounts(r, "safari"), [["2027-01-15", 11025, 525], ["2027-01-16", 3150, 150], ["2027-01-16", 13125, 625]]);
  assert.deepEqual(amounts(r, "transfer"), [["2027-01-14", 9450, 450]]);
  assert.deepEqual(amounts(r, "addon"), [["2027-01-15", 6300, 300], ["2027-01-17", 12000, 0]]);
  assert.equal(r.totals.grand, TOTAL);
  assert.equal(sum(r.lines.map((l) => l.tax)), TAX);
  assert.equal(sum(r.byProperty.map((p) => p.total)), TOTAL);
});

test("% discount on our lodges' rooms: only Kings Lodge rooms (not Roseate, Iora, safaris, transfers, flights)", () => {
  const r = priceTrip(trip({ discount: { pct: 10, scope: "lodges", reason: "repeat guest" } }), data);
  // 10% of 36,580 + 41,300 + 48,380 = 126,260 -> 12,626; GST in it 10% of 19,260 = 1,926
  const d = r.lines.filter((l) => l.kind === "discount");
  assert.deepEqual(d.map((l) => [l.property_id, l.amount, l.tax]), [["KL", -12626, -1926]]);
  assert.equal(r.totals.grand, TOTAL - 12626);
});

test("% discount on the whole trip: everything except flights, GST reduced in proportion", () => {
  const r = priceTrip(trip({ discount: { pct: 10, scope: "all", reason: "agent" } }), data);
  // 10% of 245,370 - 12,000 (flight) = 233,370 -> 23,337; GST in it 10% of 29,084 = 2,908
  const d = r.lines.filter((l) => l.kind === "discount");
  assert.deepEqual(d.map((l) => [l.amount, l.tax]), [[-23337, -2908]]);
  assert.equal(r.totals.grand, TOTAL - 23337);
});

test("markup on the total after discounts, then the manual adjustment; rounding to whole rupees", () => {
  const r = priceTrip(trip({ discount: { pct: 10, scope: "lodges", reason: "x" }, markup_pct: 5, adjustment: { amount: -381, reason: "round off" } }), data);
  // (245,370 - 12,626) = 232,744; markup 5% = 11,637.2 -> 11,637; 244,381 - 381 = 244,000
  assert.equal(r.totals.markup, 11637);
  assert.equal(r.totals.grand, 244000);
  assert.ok(r.lines.every((l) => Number.isInteger(l.amount) && Number.isInteger(l.tax)));
});

test("payments: past due dates merge into the deposit; the instalments add up to the total", () => {
  const r = priceTrip(trip({ discount: { pct: 10, scope: "lodges", reason: "x" }, markup_pct: 5, adjustment: { amount: -381, reason: "round off" } }), data);
  // arrival 13 Jan 2027 (the Roseate night); second deposit due 145 days before = 21 Aug 2026, already past
  assert.equal(r.arrival, "2027-01-13");
  assert.deepEqual(r.payments.map((p) => [p.pct, p.due, p.amount]), [[50, null, 122000], [50, "2026-11-29", 122000]]);
  assert.equal(sum(r.payments.map((p) => p.amount)), r.totals.grand);
  // an odd total: the last instalment takes the rounding, so it still adds up
  const odd = priceTrip(trip({ adjustment: { amount: 1, reason: "odd" } }), data);
  assert.equal(sum(odd.payments.map((p) => p.amount)), odd.totals.grand);
});

test("per person = total / guests (no children); with a child, the price per adult and the shares add up", () => {
  const two = priceTrip(trip({ adults: 2, children: [] }), data);
  assert.equal(two.perPerson, Math.round(two.totals.grand / 2));
  const r = priceTrip(trip(), data);
  const s = r.split!;
  const shares = s.adult * (3 - s.extra_adults) + (s.extra_adult ?? 0) * s.extra_adults + sum(s.children.map((c) => c.amount));
  assert.ok(Math.abs(shares - r.totals.grand) <= 3, `shares ${shares} vs total ${r.totals.grand}`); // rounding of each share
});

test("currency: the settings rate less the cushion, or the rate typed on the quote", () => {
  const r = priceTrip(trip({ currency: "USD" }), data);
  // 84 less 2% = 82.32; 245,370 / 82.32 = 2,980.69
  assert.equal(r.fx, 82.32);
  assert.equal(r.grandInCurrency, Math.round((TOTAL / 82.32) * 100) / 100);
  const typed = priceTrip(trip({ currency: "USD", fx_rate: 85 }), data);
  assert.equal(typed.fx, 85);
  assert.equal(typed.grandInCurrency, 2886.71);
});

test("offers: a multi-lodge offer takes % off our own lodges' rooms only, never a city hotel", () => {
  const multi: Offer = {
    id: "ML", name: "Two lodges, 10% off", offer_type: "multi_lodge", value: 10, stay_nights: null, pay_nights: null, applies_to: ["room"],
    property_ids: [], room_category_ids: [], book_from: null, book_to: null, travel_from: null, travel_to: null, min_nights: 2, min_lodges: 2, combinable: false, active: true,
  };
  const withOffer = { ...data, offers: [multi] };
  // one of our lodges only: not applied, said so
  const one = priceTrip(trip({ offer_ids: ["ML"] }), withOffer);
  assert.equal(one.appliedOffers.length, 0);
  assert.ok(one.warnings.some((w) => /needs 2 of our lodges/.test(w)));
  // Kings Lodge 3 nights + Tree House Hideaway 2 nights (in place of Iora)
  const t = trip({ offer_ids: ["ML"] });
  t.stays[2] = { property_id: "THH", room_category_id: "THH_T", meal_plan: "AP", check_in: "2027-01-17", nights: 2, rooms: 1 };
  const r = priceTrip(t, withOffer);
  // THH a night: 10,000 + 3,000 + 5,000 = 18,000 + 18% = 21,240; 2 nights 42,480
  // 10% of Kings Lodge 126,260 = 12,626 and of THH 42,480 = 4,248; Roseate House nothing
  const d = r.lines.filter((l) => l.kind === "discount").map((l) => [l.property_id, l.amount]);
  assert.deepEqual(d, [["KL", -12626], ["THH", -4248]]);
});

test("a multi-lodge offer counts the nights at our own lodges only: Iora Retreat's nights never make up the minimum", () => {
  // the trip: Kings Lodge 3 nights (ours), Iora Retreat 2 nights (partner); an offer for 2 lodges, 5 nights or more
  const multi: Offer = {
    id: "ML5", name: "Any 2 Pugdundee lodges, 5 nights or more", offer_type: "multi_lodge", value: 15, stay_nights: null, pay_nights: null, applies_to: ["room"],
    property_ids: [], room_category_ids: [], book_from: null, book_to: null, travel_from: null, travel_to: null, min_nights: 5, min_lodges: 2, combinable: false, active: true,
  };
  const withOffer = { ...data, offers: [multi] };
  const t = trip();
  t.stays = t.stays.filter((s) => s.property_id === "KL" || s.property_id === "IORA");
  // not suggested (1 own lodge, 3 own nights; Iora's 2 do not count)
  assert.ok(!priceTrip(t, withOffer).warnings.some((w) => /qualifies for/.test(w)));
  // Kings Lodge 3 + Tree House Hideaway 1 = 4 own nights (+ Iora 2): not enough, said so
  const four = trip({ offer_ids: ["ML5"] });
  four.stays = [four.stays.find((s) => s.property_id === "KL")!, { property_id: "THH", room_category_id: "THH_T", meal_plan: "AP", check_in: "2027-01-17", nights: 1, rooms: 1 }, { property_id: "IORA", room_category_id: "IORA_D", meal_plan: "AP", check_in: "2027-01-18", nights: 2, rooms: 1 }];
  const r = priceTrip(four, withOffer);
  assert.equal(r.appliedOffers.length, 0);
  assert.ok(r.warnings.some((w) => /needs at least 5 nights at our own lodges; this trip has 4/.test(w)));
  assert.ok(!priceTrip({ ...four, offer_ids: [] }, withOffer).warnings.some((w) => /qualifies for/.test(w)));
});

test("a safari rate that includes the naturalist: ticking the naturalist adds nothing and needs no price", () => {
  // Kaziranga: Rs 15,000 a jeep including the naturalist; no naturalist fee, no naturalist add-on
  const kaz = { ...data.safariRates[0], id: "KAZ_m", park_id: "KAZ", weekday_rate: 15000, weekend_rate: 15000, naturalist_fee: 0, guide_fee: 0, tax_pct: 0 };
  const withKaz = { ...data, safariRates: [...data.safariRates, { ...kaz, includes_naturalist: true }], addons: data.addons.filter((a) => !/naturalist/i.test(a.name)) };
  const t = trip({ safaris: [{ date: "2027-01-18", park_id: "KAZ", zone: "core", session: "morning", naturalist: true }] });
  const r = priceTrip(t, withKaz);
  assert.ok(!r.missing.some((m) => m.kind === "naturalist"));
  const line = r.lines.find((l) => l.group === "naturalist")!;
  assert.equal(line.amount, 0);
  assert.match(line.description, /included in the safari/);
  // without the tick it is a price to type, as before
  const without = priceTrip(t, { ...withKaz, safariRates: [...data.safariRates, kaz] });
  assert.ok(without.missing.some((m) => m.kind === "naturalist"));
  // a naturalist fee on the rate is still charged even when ticked (Bandhavgarh: Rs 3,000)
  const ban = priceTrip(trip(), { ...data, safariRates: data.safariRates.map((x) => ({ ...x, includes_naturalist: true })) });
  assert.equal(ban.lines.find((l) => l.group === "naturalist")!.unit_price, 3000);
});
