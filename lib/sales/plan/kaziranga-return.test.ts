// Run with:  npx tsx --test lib/sales/plan/kaziranga-return.test.ts
// Manav's Kaziranga quote, 4 Nov 2026, on the real Master data: "then fly back to delhi" after
// Kaziranga had no flight home (the way out was a road Iora Retreat - Delhi), and choosing Jorhat
// must move both flights and both drives to Jorhat, one flight each way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan } from "./planner";
import { extractTrip } from "./parse-text";
import { cityHotels } from "./cities";
import { realCtx } from "./real-fixture";
import type { BuilderContext, Plan } from "./types";

const T = "2026-11-04";
const ctx: BuilderContext = {
  ...realCtx,
  flightRoutes: [
    { id: "dj", from_city: "Delhi", to_city: "Jorhat", airline: "IndiGo", flight_no: "", depart_time: "", arrive_time: "", fare: 15000, cabin: "Economy" },
    { id: "jd", from_city: "Jorhat", to_city: "Delhi", airline: "IndiGo", flight_no: "", depart_time: "", arrive_time: "", fare: 15000, cabin: "Economy" },
  ] as never,
};
const name = (id: string | null | undefined) => ctx.locations.find((l) => l.id === id)?.name ?? id;
function read(...msgs: string[]) {
  let plan: Plan = emptyPlan(T);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, ctx, T);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const flightsOf = (p: Plan) => p.days.flatMap((d, i) => d.items.filter((x) => x.type === "flight").map((x) => `${i}: ${x.title}`));
const roadsOf = (p: Plan) => p.days.flatMap((d, i) => [d.transfer, ...(d.city_transfers ?? [])].filter((t) => !!t).map((t) => `${i}: ${name(t!.from_location_id)} > ${name(t!.to_location_id)}`));
const E = "2 adults from UK arriving delhi on 10 jan 2027, 1 night at roseate, then kaziranga 3 nights at iora with 4 safaris, then fly back to delhi";

test("'then fly back to delhi' after Kaziranga: a flight from Kaziranga's airport, never a road to Delhi", () => {
  const r = extractTrip(E, ctx, T, cityHotels(ctx));
  assert.deepEqual(r.flights, [{ from: "Delhi", to: "Guwahati" }, { from: "Guwahati", to: "Delhi" }]);
  assert.equal(r.departure_place, "Guwahati Airport");
  const p = read(E);
  assert.deepEqual(flightsOf(p), ["1: Flight Delhi to Guwahati", "4: Flight Guwahati to Delhi"]);
  assert.ok(!roadsOf(p).some((x) => /Iora Retreat > Delhi$/.test(x)), roadsOf(p).join(" | "));
  // without "fly" and without a Delhi night: the same
  const q = extractTrip("2 adults arriving delhi on 10 jan 2027 then kaziranga 3 nights at iora, back to delhi", ctx, T, cityHotels(ctx));
  assert.deepEqual(q.flights, [{ from: "Delhi", to: "Guwahati" }, { from: "Guwahati", to: "Delhi" }]);
});

test("Jorhat chosen: one flight each way, both from Jorhat, with the fare from Master data", () => {
  const p = read(E, "jorhat");
  assert.deepEqual(flightsOf(p), ["1: Flight Delhi to Jorhat", "4: Flight Jorhat to Delhi"]);
  assert.ok(p.days.flatMap((d) => d.items).filter((x) => x.type === "flight").every((x) => x.flight?.fare_pp === 15000));
  assert.ok(roadsOf(p).includes("1: Jorhat Airport > Iora Retreat"), roadsOf(p).join(" | "));
  assert.ok(roadsOf(p).includes("4: Iora Retreat > Jorhat Airport"), roadsOf(p).join(" | "));
});

test("a place on the lodge's side changes nothing (Nagpur for Pench)", () => {
  const r = extractTrip("2 adults arriving nagpur on 10 jan 2027, pench 3 nights, leave from nagpur", ctx, T, cityHotels(ctx));
  assert.equal(r.flights, undefined);
  assert.equal(r.arrival_place, "Nagpur Airport");
  assert.equal(r.departure_place, "Nagpur Airport");
});
