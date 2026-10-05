// Run with:  npx tsx --test lib/sales/plan/planner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDays, emptyPlan, planToTrip, defaultStop } from "./planner";
import { priceTrip } from "@/lib/sales/pricing/engine";
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
};

function sheetPlan(): Plan {
  const p = emptyPlan("2026-10-05");
  p.guest = { ...p.guest, name: "Judy & Cathy Miller", adults: 2, rooms: 2 };
  p.arrival_date = "2027-01-16";
  p.arrival_location_id = "NAG";
  p.departure_location_id = "NAG";
  p.stops = [defaultStop(ctx, "TADOBA", 4), defaultStop(ctx, "PENCH", 3)];
  p.days = buildDays(p, ctx);
  return p;
}

test("defaults pick the lodge, room and AP meal plan", () => {
  assert.deepEqual(defaultStop(ctx, "TADOBA", 4), { park_id: "TADOBA", nights: 4, property_id: "WEL", room_category_id: "WEL_AC", meal_plan: "AP" });
});

test("route Tadoba 4 + Pench 3 builds the sheet's 8 days", () => {
  const p = sheetPlan();
  assert.equal(p.days.length, 8);
  assert.deepEqual(p.days.map((d) => d.kind), ["arrival", "safari", "safari", "safari", "transfer", "safari", "safari", "departure"]);
  // Tuesday 19 Jan: Tadoba core closed -> both safaris in the buffer zone
  const tue = p.days.find((d) => d.date === "2027-01-19")!;
  assert.deepEqual(tue.safaris.map((s) => s.zone), ["buffer", "buffer"]);
  assert.ok(tue.notes[0].includes("buffer zone used"));
  assert.ok(p.days[0].text.includes("Nagpur Airport") && p.days[0].text.includes("2.5 hours"));
});

test("the generated plan prices exactly like the sheet: 5,58,670", () => {
  const r = priceTrip(planToTrip(sheetPlan(), "2026-10-05"), data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.totals.grand, 558670);
});

test("Pench on a Wednesday: afternoon core closed and no buffer rate -> morning only", () => {
  const p = emptyPlan("2026-10-05");
  p.arrival_date = "2027-01-19"; // Tue arrival, Wed is a full day
  p.stops = [defaultStop(ctx, "PENCH", 2)];
  p.guest.rooms = 1;
  const days = buildDays(p, ctx);
  const wed = days.find((d) => d.date === "2027-01-20")!;
  assert.deepEqual(wed.safaris, [{ session: "morning", zone: "core" }]);
  assert.ok(wed.notes[0].startsWith("No afternoon safari"));
});
