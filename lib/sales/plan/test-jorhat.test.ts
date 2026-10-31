// Run with:  npx tsx --test lib/sales/plan/test-jorhat.test.ts
// The owner's test trip "Test Jorhat": Delhi (Roseate House), fly to Jabalpur, Tree House
// Hideaway, Kanha Earth Lodge, Waghoba, fly Nagpur > Delhi, Roseate House, fly to Jorhat,
// Iora Retreat, fly Jorhat > Delhi. Each lodge is reached from the flight that lands just before it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { buildDays, emptyPlan, farApart, masterHotel, planToTrip } from "./planner";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { mealCode } from "@/lib/sales/pricing/meal";
import { detailedBreakdown, inTripOrder } from "@/lib/sales/pricing/breakdown";
import { roseateCtx as ctx, TEST_JORHAT, TEST_JORHAT_1, TEST_JORHAT_2 } from "./reader-fixture";
import type { Plan } from "./types";

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
const roads = (p: Plan) => planToTrip(p, TODAY).transfers.map((t) => `${t.date.slice(5)} ${t.from_location_id}>${t.to_location_id}`);

const ROADS = [
  "04-20 DEL>L_ROS",
  "04-21 JLR>L_THH",
  "04-21 L_ROS>DEL",
  "04-24 L_THH>L_KEL",
  "04-27 L_KEL>L_WEL",
  "05-01 L_WEL>NAG",
  "05-01 DEL>L_ROS",
  "05-02 JRH>L_IORA",
  "05-02 L_ROS>DEL",
  "05-05 L_IORA>JRH",
];
const FLIGHTS = ["Delhi>Jabalpur", "Nagpur>Delhi", "Delhi>Jorhat", "Jorhat>Delhi"];

function checkTrip(p: Plan) {
  assert.deepEqual(p.stops.map((s) => `${s.property_id} ${s.nights}`), ["THH 3", "KEL 3", "WEL 4", "IORA 3"]);
  assert.equal(p.arrival_date, "2027-04-21");
  assert.deepEqual([p.arrival_location_id, p.departure_location_id], ["JLR", "JRH"]);
  assert.deepEqual(p.flights?.map((f) => `${f.from}>${f.to}`), FLIGHTS);
  assert.deepEqual(p.city_stays?.map((c) => [c.city, c.hotel, c.at ?? null]), [["Delhi", "Roseate House", null], ["Delhi", "Roseate House", 3]]);
  assert.deepEqual(roads(p), ROADS);
  // Jorhat is only the way in to Iora Retreat, never to the first lodge
  assert.ok(!roads(p).some((r) => r.includes("JRH>L_THH")));
}

test("Test Jorhat in one message: Jabalpur is the way in, Jorhat only for Iora Retreat", () => {
  checkTrip(conversation()(TEST_JORHAT).plan);
});

test("Test Jorhat in two messages: the second part carries the trip on (flights added, date kept)", () => {
  const say = conversation();
  say(TEST_JORHAT_1);
  const r = say(TEST_JORHAT_2);
  checkTrip(r.plan);
  // "2 May" is the day of the new part, not a new start date: no warning, nights lead there
  assert.ok(!r.reply.warnings?.some((w) => /this part of the trip starts/.test(w)));
});

test("a wrong arrival point (a later flight's airport) never becomes the first lodge's pick-up", () => {
  const p = conversation()(TEST_JORHAT).plan;
  const wrong = { ...p, arrival_location_id: "JRH" };
  const days = buildDays(wrong, ctx);
  const first = days.find((d) => d.property_id === "THH");
  assert.deepEqual(first?.transfer, { from_location_id: "JLR", to_location_id: "L_THH" });
});

// ---- Roseate House: the city-hotel nights are priced from Master data
const priced = (p: Plan, c = ctx) => priceTrip(planToTrip(p, TODAY), c.pricing);
const hotelNights = (p: Plan, c = ctx) =>
  priced(p, c).lines.filter((l) => l.kind === "room" && l.property_id === "ROS").map((l) => `${l.date} ${l.amount}${l.missing ? " missing" : ""}`);

test("Roseate House nights: AC Deluxe B&B (CP) from Master data, Rs 17,000 + 18% from 1 Apr 2027", () => {
  const p = conversation()(TEST_JORHAT).plan;
  assert.deepEqual(hotelNights(p), ["2027-04-20 20060", "2027-05-01 20060"]);
  const night = p.days.find((d) => d.date === "2027-04-20");
  assert.deepEqual(night?.city_hotel, { property_id: "ROS", room_category_id: "ROS_D", meal_plan: "CP" });
});

test("a night before 1 Apr 2027 takes the Rs 23,000 rate", () => {
  const april = conversation()(TEST_JORHAT).plan;
  const march = { ...april, arrival_date: "2027-03-21" };
  const p = { ...march, days: buildDays(march, ctx) };
  assert.equal(hotelNights(p)[0], "2027-03-20 27140");
});

test("a second hotel row with the same name (no rooms) does not hide the one with rates", () => {
  const dup = { id: "ROS_OLD", name: "Roseate House", park_id: "DLI", kind: "partner_lodge", fallback_priority: 1, sort: 0, city: "Delhi" };
  const twice = { ...ctx, properties: [dup, ...ctx.properties], pricing: { ...ctx.pricing, properties: [{ id: "ROS_OLD", name: "Roseate House", park_id: "DLI", kind: "partner_lodge" }, ...ctx.pricing.properties] } };
  assert.equal(masterHotel(twice, "Roseate House", { date: "2027-04-20", nationality: "foreign" })?.property_id, "ROS");
  assert.equal(masterHotel(twice, "the roseate house")?.property_id, "ROS");
});

test("meal plans saved as B&B, FB, HB or Room only are read as CP, AP, MAP, EP", () => {
  assert.deepEqual(["B&B", "bb", "Bed & Breakfast", "CP", "FB", "Full board", "HB", "map", "Room only", "EP"].map(mealCode), ["CP", "CP", "CP", "CP", "AP", "AP", "MAP", "MAP", "EP", "EP"]);
});

// ---- the price lines follow the trip as typed
test("price lines in trip order, each saying what it is (lodge / hotel, room, meal plan)", () => {
  const p = conversation()(TEST_JORHAT).plan;
  // a fare on the first flight, so it is priced
  p.days = p.days.map((d) => ({ ...d, items: d.items.map((it) => (it.type === "flight" && /Jabalpur/.test(it.title) ? { ...it, flight: { ...it.flight!, fare_pp: 6000 } } : it)) }));
  const r = priced(p);
  const day = (date: string) => inTripOrder(r.lines).filter((l) => l.date === date).map((l) => `${l.kind}: ${l.description}`);
  assert.deepEqual(day("2027-04-20"), ["transfer: Delhi Airport to Roseate House", "room: Roseate House, AC Deluxe, B&B"]);
  assert.deepEqual(day("2027-04-21"), [
    "transfer: Roseate House to Delhi Airport",
    "addon: Flight Delhi to Jabalpur",
    "transfer: Jabalpur Airport to Tree House Hideaway",
    "room: Tree House Hideaway, Tree House, full board",
  ]);
  // a safari day as it goes: the morning safari, the night, the evening safari
  assert.deepEqual(day("2027-04-22"), [
    "safari: Bandhavgarh National Park core morning safari",
    "room: Tree House Hideaway, Tree House, full board",
    "safari: Bandhavgarh National Park core evening safari",
  ]);
  // the per-lodge totals in trip order: Delhi first, then the lodges as typed
  assert.deepEqual(r.byProperty.map((b) => b.name).slice(0, 5), ["Roseate House", "Tree House Hideaway", "Kanha Earth Lodge", "Waghoba Eco Lodge", "Iora Retreat"]);
});

test("the guest's breakup: a stay's nights on one row; the team's check keeps one row per night", () => {
  const r = priced(conversation()(TEST_JORHAT).plan);
  const guest = detailedBreakdown(r).rows.filter((x) => x.kind === "room").map((x) => `${x.date} ${x.label} ${x.amount}`);
  assert.deepEqual(guest, [
    "2027-04-20 Roseate House, AC Deluxe, B&B - 1 night 20060",
    "2027-04-21 Tree House Hideaway, Tree House, full board - 3 nights 75000",
    "2027-04-24 Kanha Earth Lodge, Cottage, full board - 3 nights 75000",
    "2027-04-27 Waghoba Eco Lodge, AC Cottage, full board - 4 nights 100000",
    "2027-05-01 Roseate House, AC Deluxe, B&B - 1 night 20060",
    "2027-05-02 Iora Retreat, Deluxe Room, full board - 3 nights 75000",
  ]);
  const team = detailedBreakdown(r, { spreadMarkup: false, groupNights: false }).rows.filter((x) => x.kind === "room");
  assert.equal(team.length, 15);
  assert.ok(team.every((x) => x.lkey));
  // both add up to the same total
  assert.equal(detailedBreakdown(r).total, detailedBreakdown(r, { spreadMarkup: true, groupNights: false }).total);
});

test("a price corrected by hand on a saved quote still finds its room line (key keeps the old wording)", () => {
  const p = conversation()(TEST_JORHAT).plan;
  const key = "room|2027-04-22|THH_T||Tree House x1, AP";
  const r = priced({ ...p, line_prices: { [key]: 30000 } });
  const line = r.lines.find((l) => l.lkey === key);
  assert.equal(line?.amount, 30000);
  assert.equal(line?.description, "Tree House Hideaway, Tree House, full board");
});

// ---- a city hotel named on its own is a city night, also in the middle of the trip;
// two lodges far apart are never joined by a drive when the enquiry has flights
const GERMANY =
  "2 adults from Germany, arriving Delhi 20 April 2027, 1 night Roseate House, next morning flight to Jabalpur, then Tree House Hideaway 3 nights with 4 safaris all with naturalist, then Kanha 2 nights bush dinner on last night, then Pench 2 nights, then drive to Nagpur and fly to Delhi, 1 night Roseate again, next day flight to Jorhat, Kaziranga Iora Retreat 2 nights with 2 jeep safaris and 1 camera, then fly Jorhat to Delhi and go home";

test("the German enquiry: Roseate House at the start and again in the middle, flights in between, no Pench - Iora drive", () => {
  const r = conversation()(GERMANY);
  const p = r.plan;
  assert.deepEqual(p.stops.map((s) => `${s.property_id} ${s.nights}`), ["THH 3", "KEL 2", "PTL 2", "IORA 2"]);
  // "1 night Roseate House" and "1 night Roseate again": Delhi nights at Roseate House
  assert.deepEqual(p.city_stays?.map((c) => [c.when, c.city, c.hotel, c.at ?? null]), [["before", "Delhi", "Roseate House", null], ["after", "Delhi", "Roseate House", 3]]);
  assert.deepEqual(p.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jabalpur", "Nagpur>Delhi", "Delhi>Jorhat", "Jorhat>Delhi"]);
  assert.equal(p.arrival_date, "2027-04-21"); // the first lodge; Delhi the night before
  assert.deepEqual(roads(p), [
    "04-20 DEL>L_ROS",
    "04-21 JLR>L_THH",
    "04-21 L_ROS>DEL",
    "04-24 L_THH>L_KEL",
    "04-26 L_KEL>L_PTL",
    "04-28 L_PTL>NAG",
    "04-28 DEL>L_ROS",
    "04-29 JRH>L_IORA",
    "04-29 L_ROS>DEL",
    "05-01 L_IORA>JRH",
  ]);
  assert.ok(!roads(p).some((x) => x.includes("L_PTL>L_IORA")));
  // both Delhi nights priced from Roseate House's rates
  assert.deepEqual(hotelNights(p), ["2027-04-20 20060", "2027-04-28 20060"]);
  assert.ok(!(r.flags.asks ?? []).some((a) => a.key.startsWith("far:")));
});

test("lodges far apart with nothing between them: no drive, and the way between them is asked once", () => {
  const say = conversation();
  const r = say("2 adults from Germany, 20 April 2027 fly Delhi to Jabalpur, Tree House Hideaway 3 nights, Kanha 2 nights, Pench 2 nights, then fly to Jorhat, Iora Retreat 2 nights, fly Jorhat to Delhi");
  assert.ok(!roads(r.plan).some((x) => x.includes("L_PTL>L_IORA")));
  const ask = (r.flags.asks ?? []).find((a) => a.key === "far:PTL>IORA");
  assert.ok(ask, "the way from Pench Tree Lodge to Iora Retreat is asked");
  assert.match(ask!.text, /How do the guests get from Pench Tree Lodge to Iora Retreat\?/);
  const iora = r.plan.days.find((d) => d.property_id === "IORA");
  assert.ok(iora?.notes.some((n) => /far apart/.test(n)));
  // later messages never add it again (it is asked once, then answered or dropped)
  const r2 = say("name is Mr Weber");
  assert.ok((r2.flags.asks ?? []).filter((a) => a.key === "far:PTL>IORA").length <= 1);
  assert.deepEqual(r2.flags.farAsked, ["far:PTL>IORA"]);
});

test("regions come from the roads in Master data: Kanha - Waghoba is one region (a missing rate), Pench - Iora two", () => {
  assert.equal(farApart(ctx, "L_KEL", "L_WEL"), false);
  assert.equal(farApart(ctx, "L_PTL", "L_IORA"), true);
  // so Test Jorhat keeps its Kanha Earth Lodge -> Waghoba drive (a price to type)
  assert.ok(roads(conversation()(TEST_JORHAT).plan).includes("04-27 L_KEL>L_WEL"));
});
