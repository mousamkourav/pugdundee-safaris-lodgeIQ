// Run with:  npx tsx --test lib/sales/plan/planner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDays, emptyPlan, planToTrip, defaultStop, describe } from "./planner";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { data } from "@/lib/sales/pricing/sheet-fixture";
import type { BuilderContext, Plan } from "./types";

const ctx: BuilderContext = {
  pricing: data,
  properties: [
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TADOBA", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PENCH", kind: "own_lodge", fallback_priority: 1, sort: 0 },
  ],
  locations: [
    { id: "NAG", name: "Nagpur Airport", type: "airport", property_id: null },
    { id: "L_WEL", name: "Waghoba Eco Lodge", type: "property", property_id: "WEL" },
    { id: "L_PTL", name: "Pench Tree Lodge", type: "property", property_id: "PTL" },
  ],
  rooms: [
    { id: "WEL_AC", property_id: "WEL", name: "AC Cottage", sort: 0 },
    { id: "PTL_AC", property_id: "PTL", name: "AC Cottage", sort: 0 },
  ],
  templates: [],
  content: [],
  cancellation: [],
};

function sheetPlan(): Plan {
  const p = emptyPlan("2026-10-05");
  p.guest = { ...p.guest, name: "Judy & Cathy Miller", adults: 2, rooms: 2 };
  p.arrival_date = "2027-01-16";
  p.arrival_location_id = "NAG";
  p.departure_location_id = "NAG";
  p.stops = [defaultStop(ctx, "TADOBA", 4), defaultStop(ctx, "PENCH", 3)];
  p.days = buildDays(p, ctx);
  return p;
}

test("defaults pick the lodge, room and AP meal plan", () => {
  assert.deepEqual(defaultStop(ctx, "TADOBA", 4), { park_id: "TADOBA", nights: 4, property_id: "WEL", room_category_id: "WEL_AC", meal_plan: "AP" });
});

test("route Tadoba 4 + Pench 3 builds the sheet's 8 days", () => {
  const p = sheetPlan();
  assert.equal(p.days.length, 8);
  assert.deepEqual(p.days.map((d) => d.kind), ["arrival", "safari", "safari", "safari", "transfer", "safari", "safari", "departure"]);
  // Tuesday 19 Jan: Tadoba core closed -> both safaris in the buffer zone
  const tue = p.days.find((d) => d.date === "2027-01-19")!;
  assert.deepEqual(tue.safaris.map((s) => s.zone), ["buffer", "buffer"]);
  assert.ok(tue.notes[0].includes("buffer can be used"));
  assert.ok(p.days[0].text.includes("Nagpur Airport") && p.days[0].text.includes("2.5 hours"));
});

test("the generated plan prices exactly like the sheet: 5,58,670", () => {
  const r = priceTrip(planToTrip(sheetPlan(), "2026-10-05"), data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.totals.grand, 558670);
});

test("Pench on a Wednesday: afternoon core closed and no buffer rate -> morning only", () => {
  const p = emptyPlan("2026-10-05");
  p.arrival_date = "2027-01-19"; // Tue arrival, Wed is a full day
  p.stops = [defaultStop(ctx, "PENCH", 2)];
  p.guest.rooms = 1;
  const days = buildDays(p, ctx);
  const wed = days.find((d) => d.date === "2027-01-20")!;
  assert.deepEqual(wed.safaris, [{ session: "morning", zone: "core" }]);
  assert.ok(wed.notes[0].startsWith("No afternoon safari"));
});

test("items added by hand survive a rebuild and are priced", async () => {
  const { sanitizePlan } = await import("./sanitize");
  const p = sheetPlan();
  p.days[1].items = [{ id: "a", type: "activity", title: "Bush dinner", detail: "By the lake", price: 8000, addon_id: null, qty: null }];
  p.days[6].items = [{ id: "b", type: "note", title: "Birthday cake", detail: "", price: null, addon_id: null, qty: null }];
  // shorten Pench by a night: day 7 no longer exists -> its item moves to the last day
  p.stops[1].nights = 2;
  p.days = buildDays(p, ctx);
  assert.equal(p.days.length, 7);
  assert.equal(p.days[1].items[0].title, "Bush dinner"); // same date kept
  assert.ok(p.days.some((d) => d.items.some((i) => i.title === "Birthday cake")));
  const r = priceTrip(planToTrip(p, "2026-10-05"), data);
  assert.equal(r.totals.addon, 8000);
  // a saved plan keeps items and typed prices through the sanitizer
  p.manual_prices = { "transfer|2027-01-16|NAG|L_WEL": 7000 };
  const back = sanitizePlan(JSON.parse(JSON.stringify(p)))!;
  assert.equal(back.days[1].items[0].price, 8000);
  assert.equal(back.manual_prices["transfer|2027-01-16|NAG|L_WEL"], 7000);
});

test("day text: no 'resident naturalist'; naturalist sentence only when ticked; flights priced as flights", () => {
  const p = sheetPlan();
  const safariDay = p.days.find((d) => d.kind === "safari")!;
  assert.ok(!/resident/i.test(safariDay.text), safariDay.text);
  assert.ok(!/naturalist/i.test(safariDay.text));
  const ticked = describe(ctx, { ...safariDay, safaris: safariDay.safaris.map((s, i) => ({ ...s, naturalist: i === 0 })) }, null);
  assert.match(ticked.text, /naturalist accompanies the morning safari/);
  const both = describe(ctx, { ...safariDay, safaris: safariDay.safaris.map((s) => ({ ...s, naturalist: true })) }, null);
  assert.match(both.text, /Each safari is accompanied by a naturalist/);
  p.days[0].items = [{ id: "f", type: "flight", title: "Flight Delhi to Nagpur", detail: "", price: 12000, addon_id: null, qty: null, flight: { from: "Delhi", to: "Nagpur", airline: "IndiGo", number: "6E 123", time: "08:30", pnr: "" } }];
  const t = planToTrip(p, "2026-10-05");
  assert.deepEqual(t.custom_items, [{ date: p.days[0].date, title: "Flight Delhi to Nagpur", amount: 12000, group: "flight" }]);
});

test("the plan honours wishes, city nights and flights; edited flights survive a rebuild", () => {
  const p = sheetPlan();
  p.stops[0] = { ...p.stops[0], want_safaris: 3, want_naturalists: 1, want_extras: ["nature walk"] };
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1 }, { when: "after", city: "Delhi", nights: 1 }];
  p.flights = [{ from: "Delhi", to: "Nagpur", time: "08:30" }, { from: "Nagpur", to: "Delhi" }];
  p.days = buildDays(p, ctx);
  assert.equal(p.days.length, 10); // 8 lodge days + Delhi before + Delhi at the end
  assert.equal(p.days[0].kind, "city");
  assert.equal(p.days[0].title, "Arrive in Delhi");
  assert.equal(p.days[9].title, "Depart from Delhi");
  const tadobaSafaris = p.days.filter((d) => d.park_id === "TADOBA").flatMap((d) => d.safaris);
  assert.equal(tadobaSafaris.length, 3);
  assert.equal(tadobaSafaris.filter((s) => s.naturalist).length, 1);
  assert.ok(p.days.some((d) => d.items.some((i) => i.auto?.startsWith("extra:0:nature walk"))));
  const inbound = p.days[1].items.find((i) => i.type === "flight")!;
  assert.equal(inbound.title, "Flight Delhi to Nagpur");
  assert.equal(p.days[8].items.find((i) => i.type === "flight")!.title, "Flight Nagpur to Delhi");
  // the sales person adds the ticket; a route change rebuilds the days; the ticket stays
  p.days[1].items = p.days[1].items.map((i) => (i.type === "flight" ? { ...i, flight: { ...i.flight!, airline: "IndiGo", pnr: "ABC123" } } : i));
  p.stops[1] = { ...p.stops[1], nights: 2 };
  p.days = buildDays(p, ctx);
  const kept = p.days.flatMap((d) => d.items).find((i) => i.title === "Flight Delhi to Nagpur")!;
  assert.equal(kept.flight!.pnr, "ABC123");
  assert.equal(p.days.flatMap((d) => d.items).filter((i) => i.type === "flight").length, 2); // no duplicates
  // city days cost nothing and do not change the lodge pricing
  assert.equal(priceTrip(planToTrip(p, "2026-10-05"), data).errors.length, 0);
});

test("extras priced by nationality: the guest's version is chosen", async () => {
  const { findAddon } = await import("./planner");
  const boats = {
    ...ctx,
    pricing: {
      ...ctx.pricing,
      addons: [
        { id: "BI", name: "Boat safari, 2 hours, up to 2 guests (Indian nationals)", property_id: "PTL", pricing_unit: "per_group" as const, rate: 10000, tax_pct: 5, active: true },
        { id: "BF", name: "Boat safari, 2 hours, up to 2 guests (foreign nationals)", property_id: "PTL", pricing_unit: "per_group" as const, rate: 14000, tax_pct: 5, active: true },
        { id: "BX", name: "Boat trip: each extra guest (Indian nationals)", property_id: "PTL", pricing_unit: "per_person" as const, rate: 750, tax_pct: 5, active: true },
      ],
    },
  };
  assert.equal(findAddon(boats, "PTL", "boat safari", "foreign")!.id, "BF");
  assert.equal(findAddon(boats, "PTL", "boat safari", "indian")!.id, "BI");
  assert.equal(findAddon(boats, "PTL", "boat safari")!.id, "BI"); // unknown: the cheaper one
});

test("city hotel nights are priced as City hotels; short stays still get the safaris asked for", async () => {
  const { priceBreakdown } = await import("@/lib/sales/pricing/breakdown");
  const p = sheetPlan();
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1, hotel: "The Imperial", price: 18000 }, { when: "after", city: "Delhi", nights: 1, hotel: "The Imperial", price: 18000 }];
  p.stops[1] = { ...p.stops[1], nights: 1, want_safaris: 1 };
  p.days = buildDays(p, ctx);
  assert.match(p.days[0].text, /Overnight at The Imperial, Delhi/);
  const pench = p.days.filter((d) => d.park_id === "PENCH").flatMap((d) => d.safaris);
  assert.equal(pench.length, 1);
  const r = priceTrip(planToTrip(p, "2026-10-05"), data);
  const b = priceBreakdown(r);
  assert.equal(b.rows.find((x) => x.key === "hotels")!.amount, 36000);
  assert.equal(b.total, r.totals.grand);
});

test("short park names and a steady headline", async () => {
  const { shortPark, headlineFor } = await import("./draft");
  assert.equal(shortPark("Tadoba-Andhari Tiger Reserve"), "Tadoba");
  assert.equal(shortPark("Pench National Park"), "Pench");
  assert.equal(shortPark("Satpura Tiger Reserve"), "Satpura");
  assert.equal(headlineFor("a|b"), headlineFor("a|b"));
  assert.ok(headlineFor("a|b").split(" ").length <= 6);
});

test("nights in a city at the end: drive there from the last lodge, fly out after the city nights", () => {
  const p = sheetPlan();
  p.city_stays = [{ when: "after", city: "Khajuraho", nights: 2, hotel: "Radisson Hotel Jass Khajuraho" }];
  p.flights = [{ from: "Khajuraho", to: "Delhi" }];
  p.days = buildDays(p, ctx);
  const n = p.days.length;
  const drive = p.days[n - 3];
  assert.equal(drive.kind, "departure");
  assert.equal(drive.title, "Drive to Khajuraho");
  assert.match(drive.text, /^After breakfast, drive to Khajuraho.*Overnight at Radisson Hotel Jass Khajuraho, Khajuraho\.$/);
  assert.doesNotMatch(drive.text, /onward journey/);
  assert.ok(!drive.items.some((i) => i.type === "flight"));
  assert.equal(p.days[n - 1].title, "Depart from Khajuraho");
  assert.equal(p.days[n - 1].items.find((i) => i.type === "flight")!.title, "Flight Khajuraho to Delhi");
});

test("Delhi, the lodges, Khajuraho, Delhi: days in order, city transfers and flights on the right days", () => {
  const p = sheetPlan();
  p.departure_location_id = "NAG";
  p.city_stays = [
    { when: "before", city: "Delhi", nights: 1, hotel: "Roseate House", price: 15000 },
    { when: "after", city: "Khajuraho", nights: 2, hotel: "Radisson", price: 9000 },
    { when: "after", city: "Delhi", nights: 1, hotel: "Roseate House", price: 15000 },
  ];
  p.flights = [{ from: "Delhi", to: "Nagpur" }, { from: "Khajuraho", to: "Delhi" }];
  p.days = buildDays(p, ctx);
  // 1 Delhi + 7 lodge nights + 2 Khajuraho + 1 Delhi = 11 nights, 12 days
  assert.equal(p.days.length, 12);
  assert.equal(p.days[0].date, "2027-01-15");
  assert.equal(p.days[0].title, "Arrive in Delhi");
  assert.deepEqual(p.days[0].city_transfers!.map((t) => `${t.from_label} > ${t.to_label}`), ["Delhi Airport > Roseate House"]);
  // day 2: hotel to Delhi airport, flight, Nagpur airport to the lodge
  assert.equal(p.days[1].date, "2027-01-16");
  assert.equal(p.days[1].property_id, "WEL");
  assert.deepEqual(p.days[1].city_transfers!.map((t) => `${t.from_label} > ${t.to_label}`), ["Roseate House > Delhi Airport"]);
  assert.ok(p.days[1].items.some((i) => i.title === "Flight Delhi to Nagpur"));
  // leaving Pench: drive to Khajuraho, 2 nights
  const drive = p.days[8];
  assert.equal(drive.kind, "departure");
  assert.equal(drive.title, "Drive to Khajuraho");
  assert.match(drive.text, /Overnight at Radisson, Khajuraho/);
  assert.equal(p.days[9].title, "Khajuraho");
  // Khajuraho to Delhi by air: hotel > airport, flight, airport > hotel
  const fly = p.days[10];
  assert.equal(fly.title, "Khajuraho to Delhi");
  assert.match(fly.text, /^After breakfast, check out and transfer to Khajuraho Airport for the flight to Delhi\. On arrival, transfer to Roseate House\./);
  assert.match(p.days[1].text, /^After breakfast, check out of Roseate House and transfer to Delhi Airport for the flight to Nagpur\. On arrival at Nagpur Airport, drive to /);
  assert.deepEqual(fly.city_transfers!.map((t) => `${t.from_label} > ${t.to_label}`), ["Radisson > Khajuraho Airport", "Delhi Airport > Roseate House"]);
  assert.ok(fly.items.some((i) => i.title === "Flight Khajuraho to Delhi"));
  const last = p.days[11];
  assert.equal(last.title, "Depart from Delhi");
  assert.deepEqual(last.city_transfers!.map((t) => `${t.from_label} > ${t.to_label}`), ["Roseate House > Delhi Airport"]);
  // the lodge dates do not move; city transfers not in master data are prices to type
  const r = priceTrip(planToTrip(p, "2026-10-05"), data);
  assert.equal(r.lines.filter((l) => l.kind === "room")[0].date, "2027-01-16");
  const missing = r.missing.map((m) => m.label);
  assert.ok(missing.includes("Transfer Delhi Airport to Roseate House"));
  assert.ok(missing.includes("Transfer Radisson to Khajuraho Airport"));
  // hotel nights priced: 15000 + 2 x 9000 + 15000
  assert.equal(r.lines.filter((l) => l.group === "hotel").reduce((t, l) => t + l.amount, 0), 48000);
});

test("a day added between two lodges moves the later lodge by a day", () => {
  const p = sheetPlan();
  p.city_stays = [{ when: "after", at: 1, city: "", nights: 1, blank: true, hotel: "Tiger Trails Camp", price: 6000 }];
  p.days = buildDays(p, ctx);
  assert.equal(p.days.length, 9);
  const free = p.days[4];
  assert.equal(free.kind, "city");
  assert.equal(free.title, "Free day");
  assert.equal(free.date, "2027-01-20");
  assert.equal(p.days[5].property_id, "PTL");
  assert.equal(p.days[5].date, "2027-01-21");
  const r = priceTrip(planToTrip(p, "2026-10-05"), data);
  assert.equal(r.lines.find((l) => l.kind === "room" && l.property_id === "PTL")!.date, "2027-01-21");
  assert.ok(r.lines.some((l) => l.group === "hotel" && l.amount === 6000));
});

test("a city hotel with rates in Master data is priced from them (B&B), not typed; offers leave it alone", () => {
  const withRoseate: BuilderContext = {
    ...ctx,
    pricing: {
      ...ctx.pricing,
      properties: [...ctx.pricing.properties, { id: "ROS", name: "Roseate House", park_id: null, kind: "city_hotel" }],
      rooms: [...ctx.pricing.rooms, { id: "ROS_D", property_id: "ROS", name: "AC Deluxe", max_adults: 2, max_children: 1, extra_bed: true }],
      roomRates: [
        ...ctx.pricing.roomRates,
        { id: "R1", room_category_id: "ROS_D", valid_from: "2026-10-01", valid_to: "2027-03-31", meal_plan: "CP", rate_single: null, rate_double: 23000, extra_adult: null, child_rates: [], weekend_days: [], weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 18, rates_include_tax: false, active: true, notes: null },
      ],
    },
    properties: [...ctx.properties, { id: "ROS", name: "Roseate House", park_id: null, kind: "city_hotel", fallback_priority: 1, sort: 0 }],
    rooms: [...ctx.rooms, { id: "ROS_D", property_id: "ROS", name: "AC Deluxe", sort: 0 }],
  };
  const p = sheetPlan();
  p.guest.rooms = 1;
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1, hotel: "Roseate House" }];
  p.days = buildDays(p, withRoseate);
  assert.deepEqual(p.days[0].city_hotel, { property_id: "ROS", room_category_id: "ROS_D", meal_plan: "CP" });
  const r = priceTrip(planToTrip(p, "2026-10-05"), withRoseate.pricing);
  const ros = r.lines.filter((l) => l.kind === "room" && l.property_id === "ROS");
  assert.equal(ros.length, 1);
  assert.equal(ros[0].date, "2027-01-15");
  assert.equal(ros[0].amount, 27140); // 23,000 + 18% GST
  // a price typed by hand wins
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1, hotel: "Roseate House", price: 20000 }];
  p.days = buildDays(p, withRoseate);
  assert.equal(p.days[0].city_hotel, undefined);
  assert.ok(!priceTrip(planToTrip(p, "2026-10-05"), withRoseate.pricing).lines.some((l) => l.kind === "room" && l.property_id === "ROS"));
});

test("two airport places for Delhi: the one with a transfer rate to the hotel is used, and priced", () => {
  const c2: BuilderContext = {
    ...ctx,
    pricing: {
      ...ctx.pricing,
      locations: [...ctx.pricing.locations, { id: "DEL1", name: "Delhi", property_id: null }, { id: "DEL2", name: "Delhi Airport (IGI)", property_id: null }, { id: "L_ROS", name: "Roseate House", property_id: "ROS" }],
      transferRates: [...ctx.pricing.transferRates, { id: "T_ROS", from_location_id: "DEL2", to_location_id: "L_ROS", vehicle_type: "Innova / Crysta", capacity: 6, rate: 3000, drive_hours: null, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: false, tax_pct: 0, active: true }],
    },
    properties: [...ctx.properties, { id: "ROS", name: "Roseate House", park_id: null, kind: "city_hotel", fallback_priority: 1, sort: 0 }],
    locations: [...ctx.locations, { id: "DEL1", name: "Delhi", type: "airport", property_id: null }, { id: "DEL2", name: "Delhi Airport (IGI)", type: "airport", property_id: null }, { id: "L_ROS", name: "Roseate House", type: "property", property_id: "ROS" }],
  };
  const p = sheetPlan();
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1, hotel: "Roseate House", price: 20000 }];
  p.flights = [{ from: "Delhi", to: "Nagpur" }];
  p.days = buildDays(p, c2);
  assert.deepEqual(p.days[0].city_transfers, [{ from_location_id: "DEL2", to_location_id: "L_ROS", from_label: "Delhi Airport (IGI)", to_label: "Roseate House" }]);
  const r = priceTrip(planToTrip(p, "2026-10-05"), c2.pricing);
  const t = r.lines.filter((l) => l.kind === "transfer" && /Roseate/.test(l.description));
  // in on day 1, back to the airport on day 2 (the same road the other way round), both priced
  assert.equal(t.length, 2);
  assert.ok(t.every((l) => !l.missing && l.amount === 3000));
});

test("vehicles on transfers: for the whole trip, for one road (0 = not needed), or own vehicle", () => {
  const p = sheetPlan();
  p.guest = { ...p.guest, adults: 6, rooms: 3 };
  p.days = buildDays(p, ctx);
  const transfers = (q: Plan) => priceTrip(planToTrip(q, "2026-10-05"), data).lines.filter((l) => l.kind === "transfer");
  const auto = transfers(p);
  assert.equal(auto.length, 3);
  // two vehicles on every transfer: twice the price
  const two = transfers({ ...p, transfer_vehicles: 2 });
  assert.deepEqual(two.map((l) => l.quantity), [2, 2, 2]);
  assert.equal(two[0].amount, auto[0].amount * (2 / auto[0].quantity));
  // the drive into the first lodge is not needed; one road with 3 vehicles
  const first = p.days[0].transfer!;
  const last = p.days[p.days.length - 1].transfer!;
  const mixed = transfers({ ...p, route_vehicles: { [`${first.from_location_id}>${first.to_location_id}`]: 0, [`${last.from_location_id}>${last.to_location_id}`]: 3 } });
  assert.equal(mixed.length, 2);
  assert.equal(mixed[mixed.length - 1].quantity, 3);
  // own vehicle: no transfers at all
  assert.equal(transfers({ ...p, own_vehicle: true }).length, 0);
});

test("'full-day safari' at a lodge: one day becomes a full-day safari, not an extra add-on on top", () => {
  const p = sheetPlan();
  p.stops[0] = { ...p.stops[0], want_extras: ["full-day safari"], want_naturalists: -1 };
  p.days = buildDays(p, ctx);
  const tadoba = p.days.filter((d) => d.park_id === "TADOBA");
  const full = tadoba.filter((d) => d.safaris.some((s) => s.session === "full_day"));
  assert.equal(full.length, 1);
  assert.equal(full[0].safaris.length, 1); // in place of that day's morning and evening
  assert.ok(full[0].safaris[0].naturalist);
  assert.ok(!p.days.some((d) => d.items.some((i) => /full-day/i.test(i.title))));
});

test("flights take the airline, times and fare from Master data > Flight routes", () => {
  const p = sheetPlan();
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1 }];
  p.flights = [{ from: "Delhi", to: "Nagpur" }];
  const withRoutes: BuilderContext = { ...ctx, flightRoutes: [{ id: "R1", from_city: "Delhi", to_city: "Nagpur", airline: "IndiGo", flight_no: "6E 123", depart_time: "08:30", arrive_time: "10:10", fare: 9500, cabin: "Economy" }] };
  p.days = buildDays(p, withRoutes);
  const f = p.days.flatMap((d) => d.items).find((i) => i.type === "flight")!;
  assert.deepEqual([f.flight!.airline, f.flight!.number, f.flight!.time, f.flight!.arrive, f.flight!.fare_pp, f.flight!.route_id], ["IndiGo", "6E 123", "08:30", "10:10", 9500, "R1"]);
  // priced: fare x guests
  const t = planToTrip(p, "2026-10-05");
  assert.ok(t.custom_items!.some((c) => c.group === "flight" && c.amount === 9500 * p.guest.adults));
});

test("a night in Delhi between two parks, a connecting flight to Agra, and the drive back to Delhi", () => {
  const p = sheetPlan();
  p.stops = [defaultStop(ctx, "PENCH", 2), defaultStop(ctx, "TADOBA", 2)];
  p.city_stays = [
    { when: "before", city: "Delhi", nights: 1 },
    { when: "after", city: "Delhi", nights: 1, at: 1 },
    { when: "after", city: "Agra", nights: 2 },
  ];
  p.flights = [{ from: "Delhi", to: "Nagpur" }, { from: "Nagpur", to: "Delhi" }, { from: "Delhi", to: "Nagpur" }, { from: "Nagpur", to: "Delhi" }];
  p.end_city = "Delhi";
  p.days = buildDays(p, ctx);
  const titles = p.days.map((d) => d.title);
  // Delhi 1, Pench 2, Delhi 1, Tadoba 2, Agra 2, then the last day
  assert.equal(p.days.length, 9);
  assert.equal(titles[3], "Fly to Delhi");
  assert.match(p.days[3].text, /transfer to Nagpur Airport for the flight to Delhi/);
  // the second Delhi stay leaves on the second flight out of Delhi: into Nagpur, then the lodge
  assert.equal(p.days[4].kind, "arrival");
  assert.equal(p.days[4].transfer?.from_location_id, "NAG");
  assert.equal(titles[6], "Fly to Delhi, drive to Agra");
  assert.match(p.days[6].text, /On arrival, drive to Agra/);
  assert.equal(titles[8], "Drive to Delhi");
  assert.match(p.days[8].text, /drive back to Delhi for your homebound flight/);
});

test("a second city stay with no flight of its own never reuses the first stay's flight", () => {
  const p = sheetPlan();
  p.stops = [defaultStop(ctx, "PENCH", 2), defaultStop(ctx, "TADOBA", 2)];
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1 }, { when: "after", city: "Delhi", nights: 1, at: 1 }];
  // only the flight out of the first Delhi stay is known
  p.flights = [{ from: "Delhi", to: "Nagpur" }, { from: "Nagpur", to: "Delhi" }];
  p.days = buildDays(p, ctx);
  const tadoba = p.days.find((d) => d.property_id === "WEL")!;
  assert.notEqual(tadoba.kind, "arrival"); // not "flown in" on the Delhi to Nagpur flight again
});
