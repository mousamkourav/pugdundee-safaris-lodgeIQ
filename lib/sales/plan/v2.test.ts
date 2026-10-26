// Run with:  npx tsx --test lib/sales/plan/v2.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDays, defaultStop, describe, emptyPlan, planToTrip, roomsFor } from "./planner";
import { closureNotes, defaultDraft, flightsLine, withEdits } from "./draft";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { data } from "@/lib/sales/pricing/sheet-fixture";
import type { BuilderContext, Plan } from "./types";
import type { PricingData } from "@/lib/sales/pricing/types";

// Bandhavgarh with two lodges (Tree House Hideaway, Kings Lodge) + Kanha.
const pricing: PricingData = {
  ...data,
  properties: [
    { id: "THH", name: "Tree House Hideaway", park_id: "BAN" },
    { id: "KL", name: "Kings Lodge", park_id: "BAN" },
    { id: "KEL", name: "Kanha Earth Lodge", park_id: "KAN" },
  ],
  rooms: [
    { id: "THH_TH", property_id: "THH", name: "AC Tree House", max_adults: 2, max_children: 2, extra_bed: true },
    { id: "KL_DC", property_id: "KL", name: "AC Deluxe Cottage", max_adults: 2, max_children: 2, extra_bed: true },
    { id: "KEL_DB", property_id: "KEL", name: "AC Deluxe Bungalow", max_adults: 2, max_children: 2, extra_bed: true },
  ],
  roomRates: ["THH_TH", "KL_DC", "KEL_DB"].map((room) => ({
    id: room + "_R", room_category_id: room, valid_from: "2026-10-01", valid_to: "2027-06-30", meal_plan: "AP",
    rate_single: 15000, rate_double: 18000, extra_adult: 7200, child_rates: [], weekend_days: [],
    weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 18, rates_include_tax: false, active: true,
  })),
  parks: [
    { id: "BAN", name: "Bandhavgarh National Park" },
    { id: "KAN", name: "Kanha National Park" },
    { id: "TAD", name: "Tadoba-Andhari Tiger Reserve" },
  ],
  closures: [
    { park_id: "BAN", zone: "core", closure_type: "weekly", weekday: 3, session: "afternoon", date_from: null, date_to: null, label: "Wednesday afternoon closure" },
    { park_id: "KAN", zone: "core", closure_type: "weekly", weekday: 3, session: "afternoon", date_from: null, date_to: null, label: "Wednesday afternoon closure" },
    { park_id: "TAD", zone: "core", closure_type: "weekly", weekday: 2, session: "full_day", date_from: null, date_to: null, label: "Core gates closed on Tuesday" },
    { park_id: "BAN", zone: "all", closure_type: "date_range", weekday: null, session: "full_day", date_from: "2026-11-08", date_to: "2026-11-08", label: "Diwali" },
    { park_id: "KAN", zone: "all", closure_type: "date_range", weekday: null, session: "full_day", date_from: "2026-11-08", date_to: "2026-11-08", label: "Diwali" },
    { park_id: "BAN", zone: "all", closure_type: "date_range", weekday: null, session: "full_day", date_from: "2027-03-22", date_to: "2027-03-22", label: "Holi" },
  ],
  safariRates: (["BAN", "KAN"] as const).flatMap((park) =>
    (["morning", "afternoon"] as const).flatMap((session) =>
      (["core", "buffer"] as const).map((zone) => ({
        id: `${park}_${zone}_${session}`, park_id: park, zone, vehicle_type: "exclusive_jeep", session, pricing_unit: "per_vehicle" as const, nationality: "all" as const,
        valid_from: "2026-10-01", valid_to: "2027-06-30", weekday_rate: 14500, weekend_rate: 15000, weekend_days: [0, 6], max_pax: 6, naturalist_fee: 0, guide_fee: 0, tax_pct: 5, active: true,
      }))
    )
  ),
  locations: [
    { id: "JLR", name: "Jabalpur Airport", property_id: null },
    { id: "L_THH", name: "Tree House Hideaway", property_id: "THH" },
    { id: "L_KL", name: "Kings Lodge", property_id: "KL" },
    { id: "L_KEL", name: "Kanha Earth Lodge", property_id: "KEL" },
  ],
  transferRates: [
    // stored Kings Lodge -> Jabalpur only, with a drive time: the planner finds it either way
    { id: "T1", from_location_id: "L_KL", to_location_id: "JLR", vehicle_type: "Innova / Crysta", capacity: 6, rate: 9000, drive_hours: 4, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 5, active: true },
    { id: "T2", from_location_id: "L_THH", to_location_id: "JLR", vehicle_type: "Innova / Crysta", capacity: 6, rate: 9000, drive_hours: null, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 5, active: true },
  ],
  addons: [{ id: "NAT", name: "Accompanying naturalist", property_id: null, pricing_unit: "per_vehicle", rate: 2500, tax_pct: 5, active: true }],
};

const ctx: BuilderContext = {
  pricing,
  properties: [
    { id: "THH", name: "Tree House Hideaway", park_id: "BAN", kind: "own_lodge", fallback_priority: 2, sort: 0 },
    { id: "KL", name: "Kings Lodge", park_id: "BAN", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "KEL", name: "Kanha Earth Lodge", park_id: "KAN", kind: "own_lodge", fallback_priority: 1, sort: 0 },
  ],
  locations: [
    { id: "JLR", name: "Jabalpur Airport", type: "airport", property_id: null },
    { id: "L_THH", name: "Tree House Hideaway", type: "property", property_id: "THH" },
    { id: "L_KL", name: "Kings Lodge", type: "property", property_id: "KL" },
    { id: "L_KEL", name: "Kanha Earth Lodge", type: "property", property_id: "KEL" },
  ],
  rooms: [
    { id: "THH_TH", property_id: "THH", name: "AC Tree House", sort: 0 },
    { id: "KL_DC", property_id: "KL", name: "AC Deluxe Cottage", sort: 0 },
    { id: "KEL_DB", property_id: "KEL", name: "AC Deluxe Bungalow", sort: 0 },
  ],
  templates: [],
  content: [],
  cancellation: [],
};

// Tree House Hideaway 2 nights, then Kings Lodge 2 nights (same park), from 15 Feb 2027.
function twoLodges(): Plan {
  const p = emptyPlan("2026-10-23");
  p.arrival_date = "2027-02-15";
  p.arrival_location_id = "JLR";
  p.departure_location_id = "JLR";
  p.stops = [
    { park_id: "BAN", nights: 2, property_id: "THH", room_category_id: "THH_TH", meal_plan: "AP" },
    { park_id: "BAN", nights: 2, property_id: "KL", room_category_id: "KL_DC", meal_plan: "AP" },
  ];
  p.days = buildDays(p, ctx);
  return p;
}

test("moving between two lodges in the same park: a morning safari first", () => {
  const p = twoLodges();
  const move = p.days[2]; // Wed 17 Feb: Tree House Hideaway to Kings Lodge
  assert.equal(move.kind, "transfer");
  assert.equal(move.title, "Tree House Hideaway to Kings Lodge");
  assert.deepEqual(move.safaris.map((s) => s.session), ["morning"]);
  assert.ok(move.text.startsWith("Early morning jeep safari in Bandhavgarh National Park (core zone)."), move.text);
  assert.ok(move.text.includes("drive to Kings Lodge"), move.text);
});

test("the naturalist is written with the safari on a travel day, never on its own", () => {
  const p = twoLodges();
  const move = { ...p.days[2], safaris: p.days[2].safaris.map((s) => ({ ...s, naturalist: true })) };
  const text = describe(ctx, move, null).text;
  assert.ok(text.includes("(core zone), accompanied by a naturalist."), text);
  assert.ok(!/Accompanied by a naturalist\./.test(text), text);
  // a travel day without safaris says nothing about a naturalist
  const noSafari = describe(ctx, { ...p.days[0], safaris: [] }, null).text;
  assert.ok(!/naturalist/i.test(noSafari), noSafari);
});

test("drive time is found for the road stored the other way round", () => {
  const p = twoLodges();
  const last = p.days[p.days.length - 1];
  assert.equal(last.kind, "departure");
  assert.ok(last.text.includes("about 4 hours"), last.text);
});

test("dates not fixed: Wednesday closures do not drop safaris", () => {
  const p = twoLodges();
  const wed = p.days[2]; // 17 Feb 2027 is a Wednesday, but only the morning is planned on a move day anyway
  assert.equal(wed.date, "2027-02-17");
  const p2 = { ...emptyPlan("2026-10-23"), arrival_date: "2027-02-16", stops: [defaultStop(ctx, "KAN", 2)] } as Plan;
  const dated = buildDays(p2, ctx);
  assert.deepEqual(dated[1].safaris.map((s) => s.zone), ["core", "buffer"]); // Wed: evening in the buffer zone
  const free = buildDays({ ...p2, dateless: true }, ctx);
  assert.deepEqual(free[1].safaris.map((s) => s.zone), ["core", "core"]);
});

test("more guests than the rooms take: rooms are added", () => {
  assert.equal(roomsFor(2, 1), 1);
  assert.equal(roomsFor(3, 1), 1); // extra bed
  assert.equal(roomsFor(4, 1), 2);
  assert.equal(roomsFor(6, 1), 3);
  assert.equal(roomsFor(4, 3), 3); // a choice that fits is kept
});

test("flights with a fare per person follow the number of guests", () => {
  const p = twoLodges();
  p.days[0].items = [
    { id: "f1", type: "flight", title: "Flight Delhi to Jabalpur", detail: "", price: null, addon_id: null, qty: null, flight: { from: "Delhi", to: "Jabalpur", airline: "", number: "", time: "", pnr: "", fare_pp: 6000 } },
  ];
  p.days[p.days.length - 1].items = [
    { id: "f2", type: "flight", title: "Flight Jabalpur to Delhi", detail: "", price: null, addon_id: null, qty: null, flight: { from: "Jabalpur", to: "Delhi", airline: "", number: "", time: "", pnr: "", fare_pp: 5500 } },
  ];
  const two = priceTrip(planToTrip(p, "2026-10-23"), pricing);
  const four = priceTrip(planToTrip({ ...p, guest: { ...p.guest, adults: 4, rooms: 2 } }, "2026-10-23"), pricing);
  const flights = (r: typeof two) => r.lines.filter((l) => l.group === "flight").reduce((t, l) => t + l.amount, 0);
  assert.equal(flights(two), 23000);
  assert.equal(flights(four), 46000);
  assert.equal(flightsLine(p), "Domestic flights Delhi-Jabalpur-Delhi in economy class (check-in baggage 15 kgs / cabin baggage 07 kgs)");
  // fly in to Nagpur, out of Jabalpur: two legs that do not connect
  p.days[0].items[0].flight!.to = "Nagpur";
  assert.equal(flightsLine(p), "Domestic flights Delhi-Nagpur and Jabalpur-Delhi in economy class (check-in baggage 15 kgs / cabin baggage 07 kgs)");
});

const inputs = {
  parkNames: Object.fromEntries(pricing.parks.map((p) => [p.id, p.name])),
  lodgeNames: Object.fromEntries(ctx.properties.map((p) => [p.id, p.name])),
  blocks: [],
  cancellationSlabs: [],
  closures: pricing.closures,
  today: "2026-10-23",
};

test("includes / does not include follow the itinerary", () => {
  const p = twoLodges();
  let d = defaultDraft(p, inputs);
  assert.equal(d.inclusions[0], "Stay in well-appointed rooms with attached facilities");
  assert.ok(d.inclusions.includes("All meals: breakfast, lunch and dinner"));
  assert.ok(d.inclusions.includes("Currently applicable taxes"));
  assert.ok(d.exclusions.includes("Accompanying lodge naturalist on safaris"));
  assert.ok(d.exclusions.includes("Flights and train tickets"));
  assert.ok(d.exclusions.some((x) => x.startsWith("Tips & gratuities")));
  // tick a naturalist: it moves to the includes
  p.days[1] = { ...p.days[1], safaris: p.days[1].safaris.map((s) => ({ ...s, naturalist: true })) };
  d = defaultDraft(p, inputs);
  assert.ok(d.inclusions.includes("Accompanying lodge naturalist on the safaris shown"));
  assert.ok(!d.exclusions.some((x) => x.includes("naturalist")));
  // a city hotel: meals are no longer "all meals throughout"
  d = defaultDraft({ ...p, city_stays: [{ when: "before", city: "Delhi", nights: 1, hotel: "The Imperial" }] }, inputs);
  assert.ok(d.inclusions.includes("All meals (breakfast, lunch and dinner) at Tree House Hideaway and Kings Lodge"));
  assert.ok(d.inclusions.some((x) => x.includes("The Imperial in Delhi")));
});

test("good to know: closures for the parks in the itinerary, by name, festivals in the trip only", () => {
  const p = twoLodges(); // Bandhavgarh only, February
  const notes = closureNotes(p, inputs);
  assert.deepEqual(notes, [
    "Core zones of Bandhavgarh National Park remain closed for afternoon safaris on each Wednesday but buffer safaris remain operational. We can plan the dates in a way that this day is used for travel or else a buffer safari can be availed.",
  ]); // no Tadoba line, no Diwali (Nov) or Holi (Mar)
  const mp = { ...p, stops: [...p.stops, defaultStop(ctx, "KAN", 2)], arrival_date: "2027-03-18" } as Plan;
  mp.days = buildDays(mp, ctx); // 18 - 24 Mar: Holi on 22 Mar in Bandhavgarh
  const n2 = closureNotes(mp, inputs);
  assert.ok(n2[0].startsWith("Core zones of Bandhavgarh and Kanha National Parks remain closed for afternoon safaris on each Wednesday"), n2[0]);
  assert.ok(n2.includes("Bandhavgarh National Park remains closed for the full day on Holi (22 Mar 2027)."), n2.join(" | "));
  const tadoba = { ...p, stops: [{ ...p.stops[0], park_id: "TAD" }] } as Plan;
  assert.deepEqual(closureNotes(tadoba, inputs), ["Core zones of Tadoba National Park remain closed for the full day on Tuesdays but buffer safaris remain operational."]);
});

// ---------------- Master data lists, near-copies, the mobile-phone rule ----------------
import { dedupeLines, isPhoneRule, phoneRuleFirst } from "./draft";

const MASTER_INC = [
  "Stay in well-appointed rooms with attached facilities as per the room categories shown.",
  "All meals: breakfast, lunch, and dinner at the lodges. City hotels, if any, are on a bed-and-breakfast basis.",
  "Tea and coffee service.",
  "Jeep safaris/activities as per itinerary with permit fee, jeep, park guide and naturalists.",
  "Picnic breakfasts on morning safaris and refreshments on evening safaris.",
  "Road transfers shown in the itinerary.",
  "Currently applicable taxes.",
].join("\n");

const noNearCopies = (xs: string[]) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  assert.equal(new Set(xs.map(norm)).size, xs.length, "a line appears twice: " + xs.join(" | "));
  assert.deepEqual(dedupeLines(xs), xs, "a near-copy is left: " + xs.join(" | "));
};

test("inclusions: the Master data list, plus only what depends on the itinerary, never twice", () => {
  const p = twoLodges();
  const blocks = [{ kind: "inclusions", body: MASTER_INC, park_id: null, property_id: null, is_default: true }];
  const d = defaultDraft(p, { ...inputs, blocks });
  assert.equal(d.inclusions[0], "Stay in well-appointed rooms with attached facilities as per the room categories shown.");
  assert.equal(d.inclusions.length, 7); // no default lines on top of the Master data ones
  assert.ok(!d.inclusions.includes("Stay in well-appointed rooms with attached facilities"));
  assert.ok(!d.inclusions.includes("Road transfers shown in the itinerary"));
  noNearCopies(d.inclusions);
  noNearCopies(d.exclusions);
  noNearCopies(d.notes);
  // a flight is added to the Master data list
  p.days[0].items = [{ id: "f", type: "flight", title: "Flight", detail: "", price: null, addon_id: null, qty: null, flight: { from: "Delhi", to: "Jabalpur", airline: "", number: "", time: "", pnr: "", fare_pp: 6000 } }];
  const f = defaultDraft(p, { ...inputs, blocks });
  assert.equal(f.inclusions.length, 8);
  assert.ok(f.inclusions[7].startsWith("Domestic flights Delhi-Jabalpur"));
  assert.ok(!f.exclusions.includes("Flights and train tickets"));
});

test("near-copies go, different parks and days stay", () => {
  assert.deepEqual(dedupeLines(["Road transfers shown in the itinerary.", "Road transfers shown in the itinerary", "road transfers as per itinerary"]), ["Road transfers shown in the itinerary."]);
  assert.deepEqual(dedupeLines(["All meals: breakfast, lunch and dinner at the lodges.", "All meals: breakfast, lunch and dinner"]), ["All meals: breakfast, lunch and dinner at the lodges."]);
  const closures = [
    "Core zones of Tadoba National Park remain closed for the full day on Tuesdays but buffer safaris remain operational.",
    "Core zones of Satpura National Park remain closed for the full day on Tuesdays but buffer safaris remain operational.",
    "Core zones of Tadoba National Park remain closed for the full day on Wednesdays but buffer safaris remain operational.",
  ];
  assert.deepEqual(dedupeLines(closures), closures);
});

test("the mobile-phone rule is the first point, however it is worded", () => {
  for (const s of ["Mobile phones are strictly not allowed in all the national parks.", "Cell phones are prohibited inside the park.", "No phones in the jeep.", "Phones are not allowed on safari."]) assert.ok(isPhoneRule(s), s);
  for (const s of ["Any expense of personal nature (soft or hard beverages, laundry, phone calls etc)", "Please share your phone number."]) assert.ok(!isPhoneRule(s), s);
  assert.deepEqual(phoneRuleFirst(["Check-in is at 13:30.", "Safari zones cannot be guaranteed.", "Mobile phones are not allowed inside the parks."]), ["Mobile phones are not allowed inside the parks.", "Check-in is at 13:30.", "Safari zones cannot be guaranteed."]);
  const p = twoLodges();
  const blocks = [{ kind: "important_notes", body: "Check-in is at 13:30.\nMobile phones are not allowed inside the parks.", park_id: null, property_id: null, is_default: true }];
  assert.ok(isPhoneRule(defaultDraft(p, { ...inputs, blocks }).notes[0]));
  // also after the notes were edited on the Final draft step
  assert.ok(isPhoneRule(withEdits(defaultDraft(p, inputs), { notes: ["Check-in is at 13:30.", "No mobile phones on safari."] }).notes[0]));
});

test("the Master data exclusion about flights goes when the trip has a flight, stays when it does not", () => {
  const p = twoLodges();
  const blocks = [{ kind: "exclusions", body: "Flights and train tickets unless mentioned in inclusions.\nPersonal expenses.", park_id: null, property_id: null, is_default: true }];
  assert.ok(defaultDraft(p, { ...inputs, blocks }).exclusions.some((x) => /flights and train/i.test(x)));
  p.flights = [{ from: "Delhi", to: "Jabalpur" }];
  const d = defaultDraft(p, { ...inputs, blocks });
  assert.ok(!d.exclusions.some((x) => /flights/i.test(x)), d.exclusions.join(" | "));
  assert.ok(d.exclusions.includes("Personal expenses."));
});
