// Run with:  npx tsx --test lib/sales/plan/all-in-one.test.ts
// The owner's all-in-one test enquiry of 1 Nov 2026: every kind of issue met so far in one
// message (misspelt, Hinglish, no word "flight", three Delhi nights, Kaziranga by air, Bhopal for
// Satpura, "Bandhavgarh, 3 nights Tree House Bandhavgarh", Khajuraho, a connecting flight to Delhi
// and the drive to Agra, the drive back to Delhi, a child and an infant, 2 vehicles).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan, noRoad, planToTrip } from "./planner";
import { ALL_IN_ONE, citiesCtx as ctx } from "./reader-fixture";
import type { Plan } from "./types";

const TODAY = "2026-11-01";

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
const day = (p: Plan, date: string) => p.days.find((d) => d.date === date)!;
const moves = (p: Plan, date: string) => [
  ...(day(p, date).transfer ? [`${day(p, date).transfer!.from_location_id}>${day(p, date).transfer!.to_location_id}`] : []),
  ...(day(p, date).city_transfers ?? []).map((t) => `${t.from_location_id}>${t.to_location_id}`),
];

test("the all-in-one enquiry: the whole route, the guests and the extras", () => {
  const r = conversation()(ALL_IN_ONE);
  const p = r.plan;
  // 2 adults, a child of 8, an infant (under 2), from France
  assert.equal(p.guest.adults, 2);
  assert.deepEqual(p.guest.children, [8, 1]);
  assert.equal(p.guest.country, "FR");
  // Iora 2 (4 safaris), Denwa 2 in the Forest Suite, Kanha 2, Tree House Hideaway 3 (not Kings Lodge, not Kanha 3)
  assert.deepEqual(p.stops.map((s) => `${s.property_id} ${s.nights}`), ["IORA 2", "DBE 2", "KEL 2", "THH 3"]);
  assert.equal(p.stops[1].room_category_id, "DBE_S");
  // Delhi, Delhi again after Kaziranga, Khajuraho with its extras, Agra with sightseeing; Roseate / Radisson / DoubleTree from Master data
  assert.deepEqual(
    p.city_stays?.map((c) => [c.city, c.nights, c.at ?? null, c.hotel]),
    [
      ["Delhi", 1, null, "Roseate House"],
      ["Delhi", 1, 1, "Roseate House"],
      ["Khajuraho", 2, null, "Radisson Hotel Jass Khajuraho"],
      ["Agra", 2, null, "DoubleTree by Hilton Agra"],
    ]
  );
  assert.deepEqual(p.city_stays?.[2].want_extras, ["sightseeing", "guide", "entrance"]);
  assert.deepEqual(p.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jorhat", "Jorhat>Delhi", "Delhi>Bhopal", "Khajuraho>Delhi"]);
  assert.equal(p.end_city, "Delhi");
  // the first question: which airport for Kaziranga
  assert.match(r.reply.text, /^Which airport for Kaziranga: Jorhat/);
  // the dates: Delhi from 9 Jan 2027, 15 nights
  assert.equal(p.days[0].date, "2027-01-09");
  assert.equal(p.days[p.days.length - 1].date, "2027-01-24");
});

test("Khajuraho to Agra is the flight to Delhi and the drive; the last day the drive back to Delhi", () => {
  const p = conversation()(ALL_IN_ONE).plan;
  const fly = day(p, "2027-01-22");
  assert.equal(fly.title, "Fly to Delhi, drive to Agra");
  assert.match(fly.text, /transfer to Khajuraho Airport for the flight to Delhi\. On arrival, drive to Agra\./);
  assert.ok(fly.items.some((i) => i.title === "Flight Khajuraho to Delhi"));
  assert.deepEqual(moves(p, "2027-01-22"), ["L_RAD>HJR", "DEL>L_DBT"]);
  const last = day(p, "2027-01-24");
  assert.equal(last.title, "Drive to Delhi");
  assert.deepEqual(moves(p, "2027-01-24"), ["L_DBT>DEL"]);
  // no "No road between..." note anywhere: Agra - Delhi with no rate yet is a price to type
  assert.deepEqual(p.days.flatMap((d) => d.notes.filter((n) => /^No road between/.test(n))), []);
  const missing = planToTrip(p, TODAY).transfers.map((t) => `${t.from_location_id}>${t.to_location_id}`);
  assert.ok(missing.includes("DEL>L_DBT") && missing.includes("L_DBT>DEL"));
});

test("a reply that is not an airport keeps the airport question; 'Guwahati' then changes the flights", () => {
  const say = conversation();
  say(ALL_IN_ONE);
  let r = say("australian");
  assert.equal(r.plan.guest.country, "AU");
  assert.match(r.reply.text, /^Which airport for Kaziranga/); // still asked
  r = say("Guwahati");
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Guwahati", "Guwahati>Delhi", "Delhi>Bhopal", "Khajuraho>Delhi"]);
  assert.deepEqual(moves(r.plan, "2027-01-10").sort(), ["GAU>L_IORA", "L_ROS>DEL"]);
});

test("a road that cannot be driven needs a lodge at one end; two city places are only a missing price", () => {
  assert.equal(noRoad(ctx, "L_DBT", "DEL"), false); // Agra hotel - Delhi airport: no rate yet, not impossible
  assert.equal(noRoad(ctx, "L_RAD", "L_DBT"), false); // Khajuraho - Agra hotels
  assert.equal(noRoad(ctx, "L_IORA", "L_ROS"), true); // Kaziranga lodge - Delhi hotel
  assert.equal(noRoad(ctx, "L_WEL", "L_IORA"), true); // Tadoba - Kaziranga
  assert.equal(noRoad(ctx, "L_KEL", "L_PTL"), false); // one region
});
