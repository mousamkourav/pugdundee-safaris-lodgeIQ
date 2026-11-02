// Run with:  npx tsx --test lib/sales/plan/full-circuit.test.ts
// The whole circuit (2 Nov 2026): every destination, airport, road and experience we sell.
// Each trip must plan with no impossible road and no price that is silently 0: what has no rate
// in Master data is a "price needed", nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { airportServes, buildDays, emptyPlan, planToTrip } from "./planner";
import { quoteChecks } from "./checks";
import { markConfirmed } from "./confirm";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { ALL_ACTIVITIES, FULL_CIRCUIT, fullCtx as ctx } from "./reader-fixture";
import type { Plan } from "./types";

const TODAY = "2026-11-02";
function read(...msgs: string[]) {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const day = (p: Plan, date: string) => p.days.find((d) => d.date === date)!;
const moves = (p: Plan, date: string) => [
  ...(day(p, date).transfer ? [`${day(p, date).transfer!.from_location_id}>${day(p, date).transfer!.to_location_id}`] : []),
  ...(day(p, date).city_transfers ?? []).map((t) => `${t.from_location_id}>${t.to_location_id}`),
];
const flightOn = (p: Plan, date: string) => day(p, date).items.filter((i) => i.type === "flight").map((i) => i.title);
const missingOf = (p: Plan) => priceTrip(planToTrip(markConfirmed(p, TODAY), TODAY), ctx.pricing).missing.map((m) => m.label);

test("Siliguri's airport is Bagdogra: found from the roads in Master data, not the name", () => {
  assert.equal(airportServes(ctx, "Bagdogra", "Siliguri"), true);
  assert.equal(airportServes(ctx, "Delhi", "Delhi"), true);
  assert.equal(airportServes(ctx, "Bagdogra", "Delhi"), false);
});

test("the full circuit: Siliguri by air both ways, every flight on its day, no impossible road", () => {
  const p = read(FULL_CIRCUIT);
  assert.deepEqual(p.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jorhat", "Guwahati>Bagdogra", "Bagdogra>Delhi", "Delhi>Bhopal", "Khajuraho>Delhi"]);
  // Iora Retreat to Guwahati Airport, the flight, Bagdogra Airport to Mayfair Chumta
  assert.deepEqual(flightOn(p, "2027-02-13"), ["Flight Guwahati to Bagdogra"]);
  assert.deepEqual(moves(p, "2027-02-13"), ["L_IORA>GAU", "IXB>L_MAY"]);
  // Mayfair Chumta to Bagdogra, the flight, Delhi Airport to Roseate House (never a drive to Delhi)
  assert.deepEqual(flightOn(p, "2027-02-15"), ["Flight Bagdogra to Delhi"]);
  assert.deepEqual(moves(p, "2027-02-15"), ["L_MAY>IXB", "DEL>L_ROS"]);
  assert.ok(!moves(p, "2027-02-15").includes("L_MAY>L_ROS"));
  assert.match(day(p, "2027-02-15").text, /transfer to Bagdogra Airport for the flight to Delhi/);
  // the Khajuraho flight on the day they leave Khajuraho, not the day they arrive
  assert.deepEqual(flightOn(p, "2027-03-02"), ["Flight Khajuraho to Delhi"]);
  // 2 adults, a child of 8 and an infant, 2 rooms, 2 vehicles on every transfer
  assert.deepEqual([p.guest.adults, p.guest.children, p.guest.rooms, p.transfer_vehicles], [2, [8, 1], 2, 2]);
  assert.deepEqual(p.days.flatMap((d) => d.notes.filter((n) => /^No road between/.test(n))), []);
  // the only prices to type: the Agra / Jaipur car (rates still to come) and Agra's sightseeing (no add-on)
  assert.deepEqual(missingOf(p).sort(), [
    "Agra local guide",
    "Agra sightseeing",
    "Transfer Delhi Airport to DoubleTree by Hilton Agra",
    "Transfer DoubleTree by Hilton Agra to ITC Rajputana",
    "Transfer ITC Rajputana to Delhi Airport",
  ]);
});

test("two cities with no road and no flight between them: a note and a hard check, never a drive", () => {
  const p = read(FULL_CIRCUIT);
  p.flights = (p.flights ?? []).filter((f) => !(f.from === "Bagdogra" && f.to === "Delhi"));
  p.days = buildDays(p, ctx);
  const d = day(p, "2027-02-15");
  assert.deepEqual(moves(p, "2027-02-15"), []);
  assert.ok(d.notes.some((n) => /^No road between Siliguri and Delhi in Master data: add the flight/.test(n)));
  const checks = quoteChecks(markConfirmed(p, TODAY), ctx, priceTrip(planToTrip(markConfirmed(p, TODAY), TODAY), ctx.pricing));
  assert.ok(checks.some((c) => /No road between Siliguri and Delhi/.test(c)));
});

test("every experience asked for is planned at its lodge, spread over the stay; none silently dropped", () => {
  const p = read(ALL_ACTIVITIES);
  const at = (pid: string) => p.days.filter((d) => d.property_id === pid && d.kind !== "departure").flatMap((d) => d.items.filter((i) => i.type !== "flight").map((i) => i.title)).sort();
  assert.deepEqual(at("DBE"), ["Boat safari (Foreign nationals)", "Buffer walk", "Bush dinner", "Canoe ride", "Tawa cruise (Tawa Dam to the lodge), up to 2 guests"]);
  assert.deepEqual(at("PTL"), ["Buffer walk", "Culinary workshop", "Safari breakfast (outside jeeps), up to 2 guests", "Village walk"]);
  assert.deepEqual(at("WEL"), ["Core safari from Moharli gate (extra per safari)", "Modified Gypsy (extra per safari)", "Safari lunch (outside jeeps, full day)", "Tadoba boat safari, 1 hour"]);
  assert.deepEqual(at("KEL"), ["Buffer walk", "Picnic lunch", "Special Dinner"]);
  assert.deepEqual(at("KRL"), ["Cycling (per hour)", "Fishing (half day)", "Island dinner (per couple)", "Nature walk", "Night boat safari", "Royal Enfield (per day)"]);
  // not one day piled up: the Ken River experiences spread over its 3 days
  const krlDays = p.days.filter((d) => d.property_id === "KRL" && d.items.length);
  assert.ok(krlDays.length >= 3);
  // Pench: 4 safaris, the 2 asked for in the buffer zone; Tadoba: the full day; all with a naturalist
  const pench = p.days.filter((d) => d.park_id === "PEN").flatMap((d) => d.safaris);
  assert.equal(pench.length, 4);
  assert.equal(pench.filter((s) => s.zone === "buffer").length, 2);
  assert.ok(p.days.some((d) => d.park_id === "TAD" && d.safaris.some((s) => s.session === "full_day")));
  assert.ok(p.days.flatMap((d) => d.safaris).every((s) => s.naturalist));
  // one night at Kings Lodge has no full day: said on the day
  assert.ok(p.days.some((d) => d.notes.some((n) => /^A full-day safari was asked for in Bandhavgarh National Park, but this stay has no full day/.test(n))));
  // what Master data has no add-on for is a price to type, never a 0
  const missing = missingOf(p);
  for (const m of ["Special Dinner", "Bird Watching", "Agra sightseeing", "Agra local guide"]) assert.ok(missing.includes(m), m);
});

test("an activity with no price: typed on Plan & price, it is charged", () => {
  const p = read(ALL_ACTIVITIES);
  const trip = planToTrip(markConfirmed(p, TODAY), TODAY);
  const first = priceTrip(trip, ctx.pricing);
  const m = first.missing.find((x) => x.label === "Special Dinner")!;
  assert.equal(m.kind, "extra");
  const typed = priceTrip({ ...trip, manual_prices: { ...trip.manual_prices, [m.key]: 6000 } }, ctx.pricing);
  assert.equal(typed.lines.find((l) => l.description === "Special Dinner")!.amount, 6000);
  // the box stays listed with its price; the check before saving no longer asks for it
  const withPrice = { ...markConfirmed(p, TODAY), manual_prices: { ...(p.manual_prices ?? {}), [m.key]: 6000 } };
  assert.ok(!quoteChecks(withPrice, ctx, typed).some((c) => /Special Dinner/.test(c)));
  assert.ok(quoteChecks(markConfirmed(p, TODAY), ctx, first).some((c) => /Price needed: Special Dinner/.test(c)));
});
