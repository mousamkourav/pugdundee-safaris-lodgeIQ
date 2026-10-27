// Own vehicle, train and per-stop wishes in the day plan and the price input.
// Run with:  npx tsx --test lib/sales/plan/travel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDays, defaultStop, emptyPlan, planToTrip } from "./planner";
import { sanitizePlan } from "./sanitize";
import { readerCtx as ctx, READER_TODAY } from "./reader-fixture";
import type { Plan } from "./types";

function plan(extra: Partial<Plan> = {}): Plan {
  const p: Plan = {
    ...emptyPlan(READER_TODAY),
    arrival_date: "2027-01-16",
    arrival_location_id: "JLR",
    departure_location_id: "JLR",
    stops: [{ ...defaultStop(ctx, "KAN", 3), want_safaris: null }, defaultStop(ctx, "BAN", 2)],
    ...extra,
  };
  return { ...p, days: buildDays(p, ctx) };
}
const roads = (p: Plan) => planToTrip(p, READER_TODAY).transfers.map((t) => `${t.from_location_id}>${t.to_location_id}`);

test("arriving in their own vehicle: no airport transfer, and the day says so", () => {
  const p = plan({ arrival_mode: "own", arrival_location_id: null });
  assert.equal(p.days[0].own_vehicle, true);
  assert.match(p.days[0].text, /own vehicle to Kanha Earth Lodge/);
  assert.equal(p.days[0].title, "Arrive at Kanha Earth Lodge");
  assert.deepEqual(roads(p), ["L_KEL>L_KL", "L_KL>JLR"]);
});

test("their own vehicle between the lodges: that drive is not charged", () => {
  const p = plan({ between_lodges: "own" });
  const move = p.days.find((d) => d.kind === "transfer")!;
  assert.equal(move.own_vehicle, true);
  assert.match(move.text, /drive in your own vehicle to Kings Lodge/);
  assert.deepEqual(roads(p), ["JLR>L_KEL", "L_KL>JLR"]);
  assert.ok(!p.days.find((d) => d.kind === "arrival")!.own_vehicle);
});

test("leaving in their own vehicle, and own vehicle all the way", () => {
  let p = plan({ departure_mode: "own", departure_location_id: null });
  assert.match(p.days[p.days.length - 1].text, /continue your journey in your own vehicle/);
  assert.deepEqual(roads(p), ["JLR>L_KEL", "L_KEL>L_KL"]);
  p = plan({ own_vehicle: true, arrival_location_id: null, departure_location_id: null });
  assert.deepEqual(roads(p), []);
  assert.ok(p.days.filter((d) => d.kind !== "safari" && d.kind !== "leisure").every((d) => d.own_vehicle));
});

test("by train: the transfer starts at the station", () => {
  const p = plan({ arrival_mode: "train", arrival_location_id: "KTE", stops: [defaultStop(ctx, "BAN", 2)], departure_location_id: "JLR" });
  assert.equal(p.days[0].title, "Arrive Katni Railway Station, on to Kings Lodge");
  assert.equal(roads(p)[0], "KTE>L_KL");
});

test("morning safaris only, jeeps per safari, and how many of an add-on", () => {
  const stop = { ...defaultStop(ctx, "PAN", 3), want_sessions: "morning" as const, want_jeeps: 2, want_extras: ["camera", "night boat safari"], want_qty: { camera: 1 } };
  const p = plan({ stops: [stop], arrival_location_id: "HJR", departure_location_id: "HJR" });
  const safaris = p.days.flatMap((d) => d.safaris);
  assert.ok(safaris.length > 0);
  assert.ok(safaris.every((s) => s.session === "morning" && s.jeeps === 2));
  const items = p.days.flatMap((d) => d.items);
  assert.equal(items.find((i) => i.title === "Camera fee")?.qty, 1);
  assert.ok(items.some((i) => i.title === "Night boat safari"));
});

test("the new fields survive the server's check, junk does not", () => {
  const p = plan({ arrival_mode: "train", departure_mode: "own", between_lodges: "own", requests: ["honeymoon", "honeymoon", "vegetarian"] });
  p.stops[0] = { ...p.stops[0], want_sessions: "morning", want_jeeps: 2, want_qty: { camera: 1 } };
  const s = sanitizePlan(JSON.parse(JSON.stringify(p)))!;
  assert.equal(s.arrival_mode, "train");
  assert.equal(s.departure_mode, "own");
  assert.equal(s.between_lodges, "own");
  assert.deepEqual(s.requests, ["honeymoon", "vegetarian"]);
  assert.deepEqual([s.stops[0].want_sessions, s.stops[0].want_jeeps, s.stops[0].want_qty], ["morning", 2, { camera: 1 }]);
  assert.ok(s.days.some((d) => d.own_vehicle));
  const bad = sanitizePlan({ ...JSON.parse(JSON.stringify(p)), arrival_mode: "rocket", between_lodges: "maybe" })!;
  assert.equal(bad.arrival_mode, undefined);
  assert.equal(bad.between_lodges, undefined);
});
