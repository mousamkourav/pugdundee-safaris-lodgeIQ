// Run with:  npx tsx --test lib/sales/plan/multi-region.test.ts
// Trips across regions (Delhi, Kaziranga, Delhi, Bhopal, the MP lodges, Nagpur, Delhi), written
// the way the sales team writes them: misspelt, without the word "flight". The route must come
// from Master data (roads = regions): a leg between regions is a flight, never a drive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan, buildDays, noDriveBetweenRegions, planToTrip } from "./planner";
import { fixTripWords } from "./parse-text";
import { DAY_STEP, itemStep, transferStep } from "./day-order";
import { FRANCE_MISSPELT, roseateCtx as ctx } from "./reader-fixture";
import type { Plan, PlanDay } from "./types";

const TODAY = "2026-10-31";

function conversation() {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  return (msg: string) => {
    const r = chatTurn(plan, flags, msg, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
}
const roads = (p: Plan) => planToTrip(p, TODAY).transfers.map((t) => `${t.from_location_id}>${t.to_location_id}`);

// the same trip, spelt right and with the flights written
const FRANCE_PLAIN =
  "2 guests from France arriving Delhi, 1 night in Delhi, fly Delhi to Jorhat, Kaziranga 2 nights, fly Jorhat to Delhi, 1 night in Delhi, fly Delhi to Bhopal, Satpura 2 nights, Kanha 2 nights, Pench 2 nights, Waghoba 3 nights, fly Nagpur to Delhi, 1 night in Delhi. All safaris with naturalist, and each lodge's unique experiences";

const STOPS = ["IORA 2", "DBE 2", "KEL 2", "PTL 2", "WEL 3"];
const FLIGHTS = ["Delhi>Jorhat", "Jorhat>Delhi", "Delhi>Bhopal", "Nagpur>Delhi"];
const STAYS = [
  ["before", "Delhi", 1, null, "Roseate House"],
  ["after", "Delhi", 1, 1, "Roseate House"],
  ["after", "Delhi", 1, null, "Roseate House"],
];
const ROADS = [
  "DEL>L_ROS", // Delhi night 1
  "JRH>L_IORA",
  "L_ROS>DEL",
  "L_IORA>JRH", // back to Delhi
  "DEL>L_ROS",
  "BHO>L_DBE", // Bhopal to Denwa
  "L_ROS>DEL",
  "L_DBE>L_KEL",
  "L_KEL>L_PTL",
  "L_PTL>L_WEL",
  "L_WEL>NAG", // Nagpur, the flight to Delhi
  "DEL>L_ROS",
  "L_ROS>DEL", // the last Delhi night, home
];

function checkFrance(p: Plan) {
  assert.deepEqual(p.stops.map((s) => `${s.property_id} ${s.nights}`), STOPS);
  assert.deepEqual(p.flights?.map((f) => `${f.from}>${f.to}`), FLIGHTS);
  assert.deepEqual(p.city_stays?.map((c) => [c.when, c.city, c.nights, c.at ?? null, c.hotel]), STAYS);
  assert.deepEqual([p.arrival_location_id, p.departure_location_id], ["JRH", "NAG"]);
  assert.deepEqual(roads(p), ROADS);
  // never a drive between regions, never a city as a road pick-up for a lodge
  for (const bad of ["DEL>L_IORA", "L_IORA>L_DBE", "L_WEL>DEL", "NAG>L_IORA", "L_IORA>L_ROS"]) assert.ok(!roads(p).includes(bad), bad);
  assert.ok(!roads(p).some((r) => r.includes("@")), "no 'hotel in Delhi' transfer");
  // every safari with a naturalist
  const safaris = p.days.flatMap((d) => d.safaris);
  assert.ok(safaris.length > 0 && safaris.every((s) => s.naturalist));
}

test("the misspelt enquiry: three Delhi nights, flights without the word, the right airports", () => {
  const say = conversation();
  const r = say(FRANCE_MISSPELT);
  assert.equal(r.plan.guest.country, "FR");
  assert.match(r.reply.text, /^When do they arrive in Delhi\?/);
  // "3 nigths waghoba" is 3 nights
  assert.equal(r.plan.stops[4].nights, 3);
  // Kaziranga has two airports in Master data: one question, Jorhat (the shorter drive) until answered
  assert.ok(r.reply.checklist?.some((c) => c.key === "ask:airport:Kaziranga National Park"));
  say("10 Jan 2027");
  say("2 adults");
  say("Cottage");
  const last = say("Cottage");
  assert.match(last.reply.text, /^Which airport for Kaziranga: Jorhat \(about 2 h drive\) or Guwahati \(about 5 h drive\)\?/);
  checkFrance(last.plan);
  // the date asked is the day they land in Delhi; the first lodge is the next day
  assert.equal(last.plan.days[0].date, "2027-01-10");
  assert.equal(last.plan.arrival_date, "2027-01-11");
  // the rooms were asked where a lodge has several (Denwa, Pench)
  assert.deepEqual(last.plan.stops.filter((s) => s.property_id === "DBE" || s.property_id === "PTL").map((s) => s.room_category_id), ["DBE_C", "PTL_C"]);
});

test("the same trip spelt right with the flights written gives the same route", () => {
  const say = conversation();
  say(FRANCE_PLAIN);
  say("10 Jan 2027");
  say("Cottage");
  const r = say("Cottage");
  checkFrance(r.plan);
});

test("answering Guwahati for Kaziranga changes both flights and the way in", () => {
  const say = conversation();
  say(FRANCE_MISSPELT);
  say("10 Jan 2027");
  say("2 adults");
  say("Cottage");
  say("Cottage");
  const r = say("Guwahati");
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Guwahati", "Guwahati>Delhi", "Delhi>Bhopal", "Nagpur>Delhi"]);
  assert.equal(r.plan.arrival_location_id, "GAU");
  assert.ok(roads(r.plan).includes("GAU>L_IORA") && roads(r.plan).includes("L_IORA>GAU"));
  assert.ok(!roads(r.plan).some((x) => x.includes("JRH")));
});

test("the French test trip (explicit dates and flights) keeps its route", () => {
  const r = conversation()(
    "2 adults from France, 10 Jan 2027 arrive Delhi, 1 night in Delhi at Roseate House, 11 Jan fly Delhi to Nagpur, Tadoba 2 nights at Waghoba, then Pench 2 nights by our car, 15 Jan drive to Nagpur airport and fly Nagpur to Delhi, 1 night in Delhi at Roseate House, 16 Jan fly Delhi to Guwahati, Kaziranga 2 nights at Iora Retreat with 2 safaris, 18 Jan fly Guwahati to Delhi and depart"
  );
  assert.deepEqual(r.plan.stops.map((s) => `${s.property_id} ${s.nights}`), ["WEL 2", "PTL 2", "IORA 2"]);
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Nagpur", "Nagpur>Delhi", "Delhi>Guwahati", "Guwahati>Delhi"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["NAG", "GAU"]);
  assert.deepEqual(roads(r.plan), ["DEL>L_ROS", "NAG>L_WEL", "L_ROS>DEL", "L_WEL>L_PTL", "L_PTL>NAG", "DEL>L_ROS", "GAU>L_IORA", "L_ROS>DEL", "L_IORA>GAU"]);
});

test("the planner never drives between regions, whatever it is given", () => {
  const day = (transfer: PlanDay["transfer"], city: PlanDay["city_transfers"] = []): PlanDay =>
    ({ date: "2027-01-10", kind: "transfer", property_id: "IORA", park_id: "KAZ", safaris: [], transfer, title: "", text: "", notes: [], items: [], city_transfers: city }) as PlanDay;
  const [a, b] = noDriveBetweenRegions(
    [
      day({ from_location_id: "L_WEL", to_location_id: "L_IORA" }),
      day(null, [{ from_location_id: "L_IORA", to_location_id: "L_ROS", from_label: "Iora Retreat", to_label: "Roseate House" }]),
    ],
    ctx
  );
  assert.equal(a.transfer, null);
  assert.match(a.notes[0], /^No road between Waghoba Eco Lodge and Iora Retreat in Master data: add the flight/);
  assert.deepEqual(b.city_transfers, []);
  // a road inside one region stays
  const [c] = noDriveBetweenRegions([day({ from_location_id: "L_KEL", to_location_id: "L_PTL" })], ctx);
  assert.deepEqual(c.transfer, { from_location_id: "L_KEL", to_location_id: "L_PTL" });
  // and a whole plan built with a wrong arrival point gets no Nagpur > Iora drive
  const p = emptyPlan(TODAY);
  p.arrival_date = "2027-01-10";
  p.arrival_location_id = "NAG";
  p.stops = [{ park_id: "KAZ", nights: 2, property_id: "IORA", room_category_id: "IORA_D", meal_plan: "AP" }];
  const days = buildDays(p, ctx);
  assert.equal(days[0].transfer, null);
});

test("misspelt trip words are read; other words are left alone", () => {
  assert.equal(fixTripWords("3 nigths waghoba, 2 nigts pench, 1 nite delhi, 4 safaries, 2 adluts"), "3 nights waghoba, 2 nights pench, 1 night delhi, 4 safaris, 2 adults");
  assert.equal(fixTripWords("the right sight, a safar to kanha, next day"), "the right sight, a safar to kanha, next day");
});

test("a travel day lists things in the order they happen", () => {
  // check-out to the airport, the flight, the airport to the lodge, then the safaris
  assert.equal(transferStep("Roseate House", "Delhi Airport"), DAY_STEP.leave);
  assert.equal(itemStep({ type: "flight" }), DAY_STEP.flight);
  assert.equal(transferStep("Nagpur Airport", "Waghoba Eco Lodge"), DAY_STEP.arrive);
  assert.equal(transferStep("Kanha Earth Lodge", "Pench Tree Lodge"), DAY_STEP.arrive);
  assert.ok(DAY_STEP.leave < DAY_STEP.flight && DAY_STEP.flight < DAY_STEP.arrive && DAY_STEP.arrive < DAY_STEP.safari);
});
