// Run with:  npx tsx --test lib/sales/plan/test-jorhat.test.ts
// The owner's test trip "Test Jorhat": Delhi (Roseate House), fly to Jabalpur, Tree House
// Hideaway, Kanha Earth Lodge, Waghoba, fly Nagpur > Delhi, Roseate House, fly to Jorhat,
// Iora Retreat, fly Jorhat > Delhi. Each lodge is reached from the flight that lands just before it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { buildDays, emptyPlan, planToTrip } from "./planner";
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
