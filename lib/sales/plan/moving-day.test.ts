// Run with:  npx tsx --test lib/sales/plan/moving-day.test.ts
// Manav and Naveen, 4 Nov 2026, on the real Master data:
//  - a morning safari on the day of moving lodges (Pench, then the drive to Satpura) was priced and
//    written as a safari in the NEXT park (Satpura); it is in the park they leave;
//  - "Back at the lodge for breakfast": breakfast is in the park on a morning safari;
//  - the naturalist line came before its safari in the price lines;
//  - a full-day safari's naturalist was one session's fee (2,500) instead of the full-day 7,500;
//  - the guest page's route took the first Delhi flight again (Delhi - Nagpur - Kaziranga).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { describe as describeDay, emptyPlan, planToTrip, safariParkOf } from "./planner";
import { routePath } from "./route-line";
import { realCtx } from "./real-fixture";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { inTripOrder } from "@/lib/sales/pricing/breakdown";
import type { Plan } from "./types";

const T = "2026-11-04";
const E =
  "2 adults from UK arriving delhi on 20 may 2027, 1 night at roseate, fly to nagpur, tadoba 2 nights at waghoba, then pench 3 nights, then satpura 3 nights, then drive to bhopal and fly to delhi, 1 night in delhi, then fly to jorhat, kaziranga 3 nights at iora, then fly back to delhi";
function read(...msgs: string[]) {
  let plan: Plan = emptyPlan(T);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, realCtx, T);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const P = read(E, "cottage");
const park = (id: string | null) => realCtx.pricing.parks.find((p) => p.id === id)?.name ?? id;
const moving = P.days.findIndex((d) => d.kind === "transfer" && d.park_id === "P_satpura_tiger_reserve");

// the sales person sets a core morning safari (with a naturalist) on the day they leave Pench
function withMorning(plan: Plan): Plan {
  const days = plan.days.map((d, i) => (i === moving ? describeDay(realCtx, { ...d, safaris: [{ session: "morning", zone: "core", naturalist: true }, ...d.safaris] }, plan.vehicle_type) : d));
  return { ...plan, days };
}

test("moving day: the morning safari is in the park they leave, in the price and in the text", () => {
  assert.ok(moving > 0);
  assert.equal(P.days[moving].morning_park_id, "P_pench_national_park");
  const p = withMorning(P);
  assert.equal(park(safariParkOf(p, moving, "morning")), "Pench National Park");
  assert.equal(park(safariParkOf(p, moving, "afternoon")), "Satpura Tiger Reserve");
  const trip = planToTrip(p, T);
  const s = trip.safaris.find((x) => x.date === p.days[moving].date && x.session === "morning")!;
  assert.equal(s.park_id, "P_pench_national_park");
  const text = p.days[moving].text;
  assert.match(text, /^Early morning jeep safari in Pench National Park \(core zone\), accompanied by a naturalist\./);
  assert.match(text, /Back at the lodge to check out, then drive to Denwa Backwater Escape/);
  assert.ok(!/breakfast/i.test(text), text);
  // an older quote without the field: the day before's park
  const old = { ...p, days: p.days.map((d, i) => (i === moving ? { ...d, morning_park_id: undefined } : d)) };
  assert.equal(safariParkOf(old, moving, "morning"), "P_pench_national_park");
});

test("price lines: each naturalist right after its safari, the day in travel order", () => {
  const p = withMorning(P);
  const r = priceTrip(planToTrip(p, T), realCtx.pricing);
  const day = inTripOrder(r.lines).filter((l) => l.date === p.days[moving].date).map((l) => l.description);
  assert.match(day[0], /^Pench National Park core morning safari/);
  assert.match(day[1], /^Accompanying naturalist, Pench National Park core morning safari/);
  assert.match(day[2], /^Pench Tree Lodge to Denwa Backwater Escape/);
  assert.match(day[3], /^Denwa Backwater Escape, /);
});

test("full-day safari with a naturalist: the full-day naturalist from Master data (7,500 a jeep)", () => {
  const nat = realCtx.pricing.addons.find((a) => a.name === "Accompanying naturalist" && !a.property_id)!;
  const pricing = { ...realCtx.pricing, addons: [...realCtx.pricing.addons, { ...nat, id: "nat-full", name: "Accompanying naturalist, full-day safari", rate: 7500 }] };
  const i = P.days.findIndex((d) => d.kind === "safari" && d.park_id === "P_pench_national_park");
  const p = { ...P, days: P.days.map((d, k) => (k === i ? { ...d, safaris: [{ session: "full_day" as const, zone: "core" as const, naturalist: true }] } : d)) };
  const lines = priceTrip(planToTrip(p, T), pricing).lines.filter((l) => l.date === p.days[i].date && l.group === "naturalist");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unit_price, 7500);
  // morning and evening keep the 2,500 naturalist
  const m = priceTrip(planToTrip(withMorning(P), T), pricing).lines.find((l) => l.date === P.days[moving].date && l.group === "naturalist")!;
  assert.equal(m.unit_price, 2500);
});

test("guest page route: each flight once, in travel order", () => {
  const placeNames = Object.fromEntries(realCtx.locations.map((l) => [l.id, l.name]));
  const parkNames = Object.fromEntries(realCtx.pricing.parks.map((p) => [p.id, p.name]));
  assert.equal(routePath(P, placeNames, parkNames).join(" - "), "Delhi - Nagpur - Tadoba - Pench - Satpura - Bhopal - Delhi - Jorhat - Kaziranga - Jorhat - Delhi");
});
