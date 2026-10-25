// Run with:  npx tsx --test lib/sales/plan/chat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan } from "./planner";
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
const TODAY = "2026-10-05";

function conversation() {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  return (msg: string) => {
    const r = chatTurn(plan, flags, msg, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return { ...r, plan };
  };
}

test("a step-by-step conversation that asks for each missing detail", () => {
  const say = conversation();
  let r = say("Tadoba 4 nights then Pench 3 nights");
  assert.equal(r.plan.stops.length, 2);
  assert.match(r.reply.text, /When do they arrive/);
  r = say("16 Jan 2027");
  assert.equal(r.plan.arrival_date, "2027-01-16");
  assert.match(r.reply.text, /How many guests/);
  r = say("2 adults, 2 rooms");
  assert.match(r.reply.text, /Where will they arrive/);
  assert.ok(r.reply.quick?.some((q) => q.label === "Nagpur Airport"));
  r = say("Nagpur");
  assert.equal(r.plan.arrival_location_id, "NAG");
  // the way out is asked separately, never assumed
  assert.equal(r.plan.departure_location_id, null);
  assert.match(r.reply.text, /Where do they leave from/);
  r = say("same");
  assert.equal(r.plan.departure_location_id, "NAG");
  assert.match(r.reply.text, /Total .*5,58,670/);
  assert.match(r.reply.text, /guest's name/);
  r = say("Judy & Cathy Miller");
  assert.equal(r.plan.guest.name, "Judy & Cathy Miller");
  assert.equal(r.plan.days.length, 8);
  assert.ok(r.reply.quick?.some((q) => q.action === "review"));
});

test("everything in one message is priced straight away", () => {
  const say = conversation();
  const r = say("2 adults in 2 rooms, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, Nagpur out");
  assert.match(r.reply.text, /5,58,670/);
});

test("changes in plain words: nights, add, remove, instead of, start over", () => {
  const say = conversation();
  say("2 adults in 2 rooms, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, Nagpur out");
  let r = say("make Pench 2 nights");
  assert.equal(r.plan.stops.find((s) => s.park_id === "PENCH")!.nights, 2);
  assert.equal(r.plan.days.length, 7); // day plan rebuilt
  r = say("remove Pench");
  assert.deepEqual(r.plan.stops.map((s) => s.park_id), ["TADOBA"]);
  r = say("add Pench");
  assert.match(r.reply.text, /How many nights in Pench/);
  r = say("3");
  assert.equal(r.plan.stops.find((s) => s.park_id === "PENCH")!.nights, 3);
  r = say("3 adults");
  assert.equal(r.plan.guest.adults, 3);
  assert.equal(r.plan.guest.rooms, 2); // rooms were set explicitly, so they stay
  r = say("start over");
  assert.equal(r.plan.stops.length, 0);
});

test("quick-reply buttons and a name typed at any time", () => {
  const say = conversation();
  say("Tadoba 4 nights then Pench 3 nights");
  say("16 Jan 2027");
  let r = say("2 adults");
  const nag = r.reply.quick!.find((q) => q.label === "Nagpur Airport")!;
  r = say(nag.text!);
  assert.equal(r.plan.arrival_location_id, "NAG");
  assert.equal(r.plan.departure_location_id, null);
  const same = r.reply.quick!.find((q) => q.label.startsWith("Same"))!;
  r = say(same.text!);
  assert.equal(r.plan.departure_location_id, "NAG");
  const say2 = conversation();
  say2("Tadoba 2 nights");
  r = say2("Judy & Cathy Miller");
  assert.equal(r.plan.guest.name, "Judy & Cathy Miller");
  r = say2("hello there");
  assert.match(r.reply.text, /did not catch/);
});

test("a name at the start of the enquiry", () => {
  const say = conversation();
  const r = say("Mr Shah, 2 adults, Tadoba 3 nights");
  assert.equal(r.plan.guest.name, "Mr Shah");
  const say2 = conversation();
  const r2 = say2("Mr Shah from UK, 2 adults, Tadoba 3 nights, +44 7400 123456");
  assert.equal(r2.plan.guest.name, "Mr Shah");
  assert.equal(r2.plan.guest.country, "GB");
  assert.equal(r2.plan.guest.nationality, "foreign");
  assert.equal(r2.plan.guest.phone, "+447400123456");
  assert.equal(r.plan.guest.adults, 2);
});

test("contact details and names in the message", () => {
  const say = conversation();
  const r = say("for Mrs. Anderson, judy@example.com, +44 7700 900123, Tadoba 3 nights");
  assert.equal(r.plan.guest.name, "Mrs. Anderson");
  assert.equal(r.plan.guest.email, "judy@example.com");
  assert.ok(r.plan.guest.phone.includes("7700"));
});

test("problems are explained, not hidden", () => {
  const noTransfers = { ...ctx, pricing: { ...ctx.pricing, transferRates: [] } };
  let plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), "2 adults, arriving Nagpur 16 Jan 2027, Tadoba 4 nights, Nagpur out", noTransfers, TODAY);
  // missing transfer prices do not block: total so far, and what is still needed
  assert.match(r.reply.text, /Total so far/);
  assert.ok(r.reply.warnings!.some((w) => w.includes("not in master data") && w.includes("Transfer Nagpur Airport to Waghoba Eco Lodge")));
  assert.ok(r.reply.quick!.some((q) => q.action === "review"));
  r = chatTurn(r.plan, r.flags, "on their own", noTransfers, TODAY);
  assert.equal(r.plan.arrival_location_id, null);
  assert.match(r.reply.text, /Total/);
  plan = emptyPlan(TODAY);
  r = chatTurn(plan, initialFlags(plan), "hello there", ctx, TODAY);
  assert.match(r.reply.text, /did not catch/);
});

test("asks Cottage or Tree House where a lodge has both; asks the way out separately", () => {
  const treeCtx = { ...ctx, rooms: [...ctx.rooms, { id: "PTL_T", property_id: "PTL", name: "AC Treehouse", sort: 1 }], pricing: { ...ctx.pricing, roomRates: [...ctx.pricing.roomRates, ...ctx.pricing.roomRates.filter((r) => r.room_category_id === "PTL_AC").map((r) => ({ ...r, id: r.id + "_T", room_category_id: "PTL_T" }))] } };
  let plan = emptyPlan(TODAY);
  let flags = initialFlags(plan);
  const say = (m: string) => {
    const r = chatTurn(plan, flags, m, treeCtx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
  let r = say("2 adults, Indian, 16 Jan 2027, arriving at Nagpur, Tadoba 4 nights then Pench 3 nights");
  assert.match(r.reply.text, /Where do they leave from/);
  r = say("leaving on their own");
  assert.equal(plan.departure_location_id, null);
  assert.equal(plan.arrival_location_id, "NAG"); // only the way out was cleared
  assert.match(r.reply.text, /Cottage or Tree ?house at Pench Tree Lodge/i);
  r = say("tree house");
  assert.equal(plan.stops[1].room_category_id, "PTL_T");
  assert.doesNotMatch(r.reply.text, /Cottage or Tree ?house/i);
});

test("a lodge with four room types: asks with their names; forest suite / deluxe room understood", () => {
  const four = [
    { id: "PTL_C", property_id: "PTL", name: "AC Cottage", sort: 0 },
    { id: "PTL_T", property_id: "PTL", name: "AC Treehouse", sort: 1 },
    { id: "PTL_S", property_id: "PTL", name: "Forest Suite", sort: 2 },
    { id: "PTL_D", property_id: "PTL", name: "Deluxe Room", sort: 3 },
  ];
  const base = ctx.pricing.roomRates.filter((r) => r.room_category_id === "PTL_AC");
  const c4 = { ...ctx, rooms: [...ctx.rooms.filter((r) => r.property_id !== "PTL"), ...four], pricing: { ...ctx.pricing, roomRates: [...ctx.pricing.roomRates, ...four.flatMap((rm) => base.map((r) => ({ ...r, id: r.id + rm.id, room_category_id: rm.id })))] } };
  let plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), "2 adults, Indian, 16 Jan 2027, Nagpur in and out, Pench 3 nights", c4, TODAY);
  assert.match(r.reply.text, /Which room at Pench Tree Lodge: Cottage, Treehouse, Forest Suite or Deluxe Room/);
  assert.deepEqual(r.reply.quick!.map((q) => q.label), ["Cottage", "Treehouse", "Forest Suite", "Deluxe Room"]);
  r = chatTurn(r.plan, r.flags, "deluxe room", c4, TODAY);
  assert.equal(r.plan.stops[0].room_category_id, "PTL_D");
  plan = emptyPlan(TODAY);
  r = chatTurn(plan, initialFlags(plan), "2 adults, 16 Jan 2027, Nagpur in and out, Pench 3 nights in the forest suite", c4, TODAY);
  assert.equal(r.plan.stops[0].room_category_id, "PTL_S");
});

test("asks the hotel for city nights; 'same' copies the other stay", () => {
  let plan = emptyPlan(TODAY);
  let flags = initialFlags(plan);
  const say = (m: string) => {
    const r = chatTurn(plan, flags, m, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
  let r = say("2 adults, Indian, land in delhi, stay one night at delhi then fly to nagpur on 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, then leave from nagpur to delhi, stay in delhi one night");
  assert.equal(plan.arrival_location_id, "NAG");
  assert.equal(plan.departure_location_id, "NAG");
  assert.match(r.reply.text, /Which hotel in Delhi \(1 night before the safari\)/);
  r = say("The Imperial, 18k");
  assert.match(r.reply.text, /Which hotel in Delhi \(1 night at the end\)/);
  assert.ok(r.reply.quick!.some((q) => q.label === "Same: The Imperial"));
  r = say("same");
  assert.deepEqual(plan.city_stays!.map((c) => [c.hotel, c.price]), [["The Imperial", 18000], ["The Imperial", 18000]].slice(0, plan.city_stays!.length));
});

test("asks which lodge where a park has two of ours; a named lodge needs no question", () => {
  const two = { ...ctx, properties: [...ctx.properties, { id: "PT2", name: "Pench Jungle Camp", park_id: "PENCH", kind: "own_lodge", fallback_priority: 2, sort: 1 }], rooms: [...ctx.rooms, { id: "PT2_AC", property_id: "PT2", name: "AC Cottage", sort: 0 }], locations: [...ctx.locations, { id: "L_PT2", name: "Pench Jungle Camp", type: "property", property_id: "PT2" }] };
  const plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), "2 adults, Indian, 16 Jan 2027, Nagpur in and out, Pench 3 nights", two, TODAY);
  assert.match(r.reply.text, /Which lodge in Pench[^:]*: Pench Tree Lodge or Pench Jungle Camp\?/);
  r = chatTurn(r.plan, r.flags, "Pench Jungle Camp", two, TODAY);
  assert.equal(r.plan.stops[0].property_id, "PT2");
  assert.doesNotMatch(r.reply.text, /Which lodge/);
  const named = chatTurn(plan, initialFlags(plan), "2 adults, Indian, 16 Jan 2027, Nagpur in and out, 3 nights at Pench Tree Lodge", two, TODAY);
  assert.doesNotMatch(named.reply.text, /Which lodge/);
});

test("the AI choosing a lodge the message did not name: the lodge question is still asked", async () => {
  const { aiToParsed } = await import("./ai");
  const two = { ...ctx, properties: [...ctx.properties, { id: "PT2", name: "Pench Jungle Camp", park_id: "PENCH", kind: "own_lodge", fallback_priority: 2, sort: 1 }], rooms: [...ctx.rooms, { id: "PT2_AC", property_id: "PT2", name: "AC Cottage", sort: 0 }], locations: [...ctx.locations, { id: "L_PT2", name: "Pench Jungle Camp", type: "property", property_id: "PT2" }] };
  const plan = emptyPlan(TODAY);
  const msg = "2 adults, Indian, 16 Jan 2027, Nagpur in and out, Pench 3 nights";
  // Gemini answers with a lodge on its own
  const ai = aiToParsed({ adults: 2, nationality: "indian", arrival_date: "2027-01-16", arrival_place: "Nagpur Airport", departure_place: "Nagpur Airport", stops: [{ park: "Pench", lodge: "Pench Jungle Camp", nights: 3 }] }, two);
  assert.equal(ai.parks[0].lodge, "Pench Jungle Camp");
  const r = chatTurn(plan, initialFlags(plan), msg, two, TODAY, ai, { aiPrimary: true });
  assert.match(r.reply.text, /Which lodge in Pench/);
  assert.ok(!(r.flags.lodgeDecided ?? []).includes("PENCH"));
  // when the message does name it, the AI's lodge is used and nothing is asked
  const named = chatTurn(plan, initialFlags(plan), msg.replace("Pench 3 nights", "3 nights at Pench Jungle Camp"), two, TODAY, ai, { aiPrimary: true });
  assert.equal(named.plan.stops[0].property_id, "PT2");
  assert.doesNotMatch(named.reply.text, /Which lodge/);
});

test("a city hotel in Master data is a city stay, never a safari stop", async () => {
  // Delhi and Khajuraho kept under Parks (no safari rates), with Roseate House / Radisson in them
  const withCities: BuilderContext = {
    ...ctx,
    pricing: { ...ctx.pricing, parks: [...ctx.pricing.parks, { id: "DEL", name: "Delhi" }, { id: "KHJ", name: "Khajuraho" }] },
    properties: [
      ...ctx.properties,
      { id: "ROS", name: "Roseate House", park_id: "DEL", kind: "partner_lodge", fallback_priority: 1, sort: 0 },
      { id: "RAD", name: "Radisson Hotel Jass Khajuraho", park_id: "KHJ", kind: "city_hotel", fallback_priority: 1, sort: 0 },
    ],
    locations: [...ctx.locations, { id: "L_ROS", name: "Roseate House", type: "property", property_id: "ROS" }],
  };
  let plan = emptyPlan(TODAY);
  let flags = initialFlags(plan);
  const say = (m: string) => {
    const r = chatTurn(plan, flags, m, withCities, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
  let r = say("2 adults, Indian, stay one night in delhi then fly to nagpur and reach Tadoba on 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, leave from nagpur");
  assert.deepEqual(plan.stops.map((s) => s.property_id), ["WEL", "PTL"]);
  assert.match(r.reply.text, /Which hotel in Delhi/);
  assert.ok(r.reply.quick!.some((q) => q.label === "Roseate House"));
  r = say("Roseate House, 18000");
  assert.deepEqual(plan.stops.map((s) => s.property_id), ["WEL", "PTL"]); // still no Roseate stop
  assert.deepEqual(plan.city_stays!.map((c) => [c.city, c.hotel, c.price]), [["Delhi", "Roseate House", 18000]]);
  assert.doesNotMatch(r.reply.text, /Which hotel in Delhi/);
  // named in the first message
  plan = emptyPlan(TODAY);
  flags = initialFlags(plan);
  r = say("2 adults, Indian, 1 night in Delhi at the Roseate, then fly to nagpur and reach Tadoba on 16 Jan 2027, Tadoba 4 nights, leave from nagpur");
  assert.equal(plan.city_stays![0].hotel, "Roseate House");
  assert.deepEqual(plan.stops.map((s) => s.property_id), ["WEL"]);
  // the Data check leaves cities and city hotels alone
  const { checkData } = await import("@/lib/sales/pricing/health");
  const issues = checkData({ ...withCities.pricing, properties: withCities.properties }, TODAY).map((i) => i.message).join("\n");
  assert.doesNotMatch(issues, /Delhi|Khajuraho|Roseate|Radisson/);
});

test("several city stays at the end: Khajuraho, then Delhi; a hotel asked for each", () => {
  const withAir: BuilderContext = { ...ctx, locations: [...ctx.locations, { id: "KHJ_AP", name: "Khajuraho Airport", type: "airport", property_id: null }] };
  let plan = emptyPlan(TODAY);
  let flags = initialFlags(plan);
  const say = (m: string) => {
    const r = chatTurn(plan, flags, m, withAir, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
  let r = say("2 adults, foreign. 1 night in Delhi, then fly Delhi to Nagpur and reach Tadoba on 16 Jan 2027. Tadoba 4 nights, Pench 3 nights. Then 2 nights in Khajuraho, fly Khajuraho to Delhi and 1 night in Delhi before flying home.");
  assert.deepEqual(plan.city_stays!.map((c) => `${c.when} ${c.city} ${c.nights}`), ["before Delhi 1", "after Khajuraho 2", "after Delhi 1"]);
  assert.equal(plan.departure_location_id, "KHJ_AP");
  assert.match(r.reply.text, /Which hotel in Delhi \(1 night before the safari\)/);
  r = say("The Imperial, 18000");
  assert.match(r.reply.text, /Which hotel in Khajuraho/);
  r = say("Radisson, 9000");
  assert.match(r.reply.text, /Which hotel in Delhi \(1 night at the end\)/);
  r = say("same");
  assert.deepEqual(plan.city_stays!.map((c) => [c.hotel, c.price]), [["The Imperial", 18000], ["Radisson", 9000], ["The Imperial", 18000]]);
  const days = plan.days;
  assert.equal(days[days.length - 1].title, "Depart from Delhi");
  assert.ok(days.some((d) => d.title === "Khajuraho to Delhi" && d.items.some((i) => i.title === "Flight Khajuraho to Delhi")));
});

test("Roseate House from Master data: its rates and the airport transfer are priced; the arrival is the flight's airport", async () => {
  const { priceTrip } = await import("@/lib/sales/pricing/engine");
  const { planToTrip } = await import("./planner");
  const { aiToParsed } = await import("./ai");
  const places = [
    { id: "DEL1", name: "Delhi", type: "airport", property_id: null },
    { id: "IGI", name: "Delhi Airport (IGI)", type: "airport", property_id: null },
    { id: "KHJ_AP", name: "Khajuraho Airport", type: "airport", property_id: null },
    { id: "L_ROS", name: "Roseate House", type: "property", property_id: "ROS" },
  ];
  const full: BuilderContext = {
    ...ctx,
    pricing: {
      ...ctx.pricing,
      parks: [...ctx.pricing.parks, { id: "DELP", name: "Delhi" }],
      properties: [...ctx.pricing.properties, { id: "ROS", name: "Roseate House", park_id: "DELP", kind: "city_hotel" }],
      rooms: [...ctx.pricing.rooms, { id: "ROS_D", property_id: "ROS", name: "AC Deluxe", max_adults: 2, max_children: 1, extra_bed: true }],
      roomRates: [...ctx.pricing.roomRates, { id: "RR", room_category_id: "ROS_D", valid_from: "2026-10-01", valid_to: "2027-03-31", meal_plan: "CP", rate_single: null, rate_double: 23000, extra_adult: null, child_rates: [], weekend_days: [], weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 18, rates_include_tax: false, active: true, notes: null }],
      locations: [...ctx.pricing.locations, ...places.map(({ type: _t, ...l }) => l)],
      transferRates: [...ctx.pricing.transferRates, { id: "T_ROS", from_location_id: "IGI", to_location_id: "L_ROS", vehicle_type: "Innova / Crysta", capacity: 6, rate: 3000, drive_hours: null, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: false, tax_pct: 0, active: true }],
    },
    properties: [...ctx.properties, { id: "ROS", name: "Roseate House", park_id: "DELP", kind: "city_hotel", fallback_priority: 1, sort: 0 }],
    rooms: [...ctx.rooms, { id: "ROS_D", property_id: "ROS", name: "AC Deluxe", sort: 0 }],
    locations: [...ctx.locations, ...places],
  };
  const msg = "2 Guest arriving delhi on 15th Mar'27; Delhi 1 nights stay at Roseate House; fly to nagpur transfer to tadoba stay for 4 nights; transfer to pench stay for 3 nights; transfer to Khajuraho 2 nights stay; fly to Delhi 1 nights stay at delhi; drop to airport";
  const check = (r: ReturnType<typeof chatTurn>) => {
    assert.equal(r.plan.arrival_location_id, "NAG");
    assert.equal(r.plan.departure_location_id, "KHJ_AP");
    assert.equal(r.plan.days[0].date, "2027-03-15");
    assert.deepEqual(r.plan.days[0].city_hotel, { property_id: "ROS", room_category_id: "ROS_D", meal_plan: "CP" });
    const p = priceTrip(planToTrip(r.plan, TODAY), full.pricing);
    assert.ok(p.lines.some((l) => l.kind === "room" && l.property_id === "ROS" && l.amount === 27140));
    assert.ok(!p.missing.some((m) => /Roseate/.test(m.label)), p.missing.map((m) => m.label).join("; "));
  };
  const plan = emptyPlan(TODAY);
  check(chatTurn(plan, initialFlags(plan), msg, full, TODAY));
  // Gemini leaving out the flight out of Khajuraho and the last Delhi night: the reader's fuller list is kept
  const ai = aiToParsed(
    { adults: 2, arrival_date: "2027-03-16", arrival_place: "Khajuraho Airport", stops: [{ park: "Tadoba-Andhari Tiger Reserve", nights: 4 }, { park: "Pench National Park", nights: 3 }], flights: [{ from: "Delhi", to: "Nagpur" }], city_stays: [{ when: "before", city: "Delhi", nights: 1, hotel: "Roseate House" }] },
    full
  );
  check(chatTurn(plan, initialFlags(plan), msg, full, TODAY, ai, { aiPrimary: true }));
});

test("the whole Delhi - lodges - Khajuraho - Delhi trip from one message: naturalists, Khajuraho extras, the last drop", () => {
  const places = [
    { id: "IGI", name: "Delhi Airport (IGI)", type: "airport", property_id: null },
    { id: "KHJ_AP", name: "Khajuraho Airport", type: "airport", property_id: null },
    { id: "L_ROS", name: "Roseate House", type: "property", property_id: "ROS" },
    { id: "L_RAD", name: "Radisson Hotel Jass Khajuraho", type: "property", property_id: "RAD" },
  ];
  const addon = (id: string, name: string, unit: "per_person" | "per_group" | "per_vehicle", rate: number) => ({ id, name, property_id: "RAD", pricing_unit: unit, rate, tax_pct: 0, active: true });
  const full: BuilderContext = {
    ...ctx,
    pricing: {
      ...ctx.pricing,
      parks: [...ctx.pricing.parks, { id: "DELP", name: "Delhi" }, { id: "KHP", name: "Khajuraho" }],
      properties: [...ctx.pricing.properties, { id: "ROS", name: "Roseate House", park_id: "DELP", kind: "city_hotel" }, { id: "RAD", name: "Radisson Hotel Jass Khajuraho", park_id: "KHP", kind: "city_hotel" }],
      locations: [...ctx.pricing.locations, ...places.map(({ type: _t, ...l }) => l)],
      addons: [...ctx.pricing.addons, addon("KG", "Khajuraho sightseeing: guide, per day", "per_group", 5000), addon("KV", "Khajuraho sightseeing: vehicle, per day", "per_vehicle", 6000), addon("KE", "Khajuraho temple entrances", "per_person", 1500)],
    },
    properties: [...ctx.properties, { id: "ROS", name: "Roseate House", park_id: "DELP", kind: "city_hotel", fallback_priority: 1, sort: 0 }, { id: "RAD", name: "Radisson Hotel Jass Khajuraho", park_id: "KHP", kind: "city_hotel", fallback_priority: 1, sort: 0 }],
    locations: [...ctx.locations, ...places],
  };
  const msg =
    "2 adults, foreign nationals, arriving Delhi on 15 Mar 2027. Delhi 1 night stay at Roseate House; fly Delhi to Nagpur and transfer to Waghoba Eco Lodge for 4 nights; transfer to Pench Tree Lodge for 3 nights; all safaris with naturalist. Transfer to Khajuraho 2 nights stay at Radisson Hotel Jass Khajuraho with sightseeing, guide and entrances; fly Khajuraho to Delhi and 1 night stay at Roseate House; drop to Delhi airport for the onward flight. Full board.";
  const plan = emptyPlan(TODAY);
  const r = chatTurn(plan, initialFlags(plan), msg, full, TODAY);
  const days = r.plan.days;
  const saf = days.flatMap((d) => d.safaris);
  assert.ok(saf.length > 0 && saf.every((s) => s.naturalist));
  const kh = days.find((d) => d.title === "Khajuraho")!;
  assert.deepEqual(kh.items.filter((i) => i.addon_id).map((i) => i.addon_id).sort(), ["KE", "KG", "KV"]);
  const last = days[days.length - 1];
  assert.equal(last.title, "Depart from Delhi");
  assert.deepEqual(last.city_transfers!.map((t) => `${t.from_label} > ${t.to_label}`), ["Roseate House > Delhi Airport (IGI)"]);
});
