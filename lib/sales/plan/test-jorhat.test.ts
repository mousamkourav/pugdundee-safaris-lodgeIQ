// Run with:  npx tsx --test lib/sales/plan/test-jorhat.test.ts
// The owner's test trip "Test Jorhat": Delhi (Roseate House), fly to Jabalpur, Tree House
// Hideaway, Kanha Earth Lodge, Waghoba, fly Nagpur > Delhi, Roseate House, fly to Jorhat,
// Iora Retreat, fly Jorhat > Delhi. Each lodge is reached from the flight that lands just before it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { buildDays, emptyPlan, masterHotel, planToTrip } from "./planner";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { mealCode } from "@/lib/sales/pricing/meal";
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
