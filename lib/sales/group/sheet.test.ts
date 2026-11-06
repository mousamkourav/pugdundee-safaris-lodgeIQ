// Run with:  npx tsx --test lib/sales/group/sheet.test.ts
// The group costing sheet built from a trip on the owner's REAL Master data (real-fixture.ts): the
// owner's group (Delhi - Kaziranga - Delhi - Kanha - Tadoba), each day's six costs from the same
// pricing engine as every quote, then the ladder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "@/lib/sales/plan/chat";
import { emptyPlan, planToTrip } from "@/lib/sales/plan/planner";
import { markConfirmed } from "@/lib/sales/plan/confirm";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { realCtx } from "@/lib/sales/plan/real-fixture";
import { buildCostSheet, costSheet } from "./sheet";
import { defaultGroup, priceGroup, rowFor, sheetTotals } from "./costing";

const T = "2026-11-06";
const MSG =
  "6 adults from usa, 3 rooms, arriving delhi 10 feb 2027, delhi 1 night at roseate house, fly to guwahati, kaziranga 3 nights at iora retreat, then fly guwahati to delhi, delhi 1 night at roseate house, fly to jabalpur, kanha 4 nights at kanha earth lodge, tadoba 4 nights at waghoba eco lodge, drive to nagpur and fly to delhi";
const plan = markConfirmed(chatTurn(emptyPlan(T), initialFlags(emptyPlan(T)), MSG, realCtx, T).plan, T);
const G = { ...defaultGroup(), per_jeep: 2, per_vehicle: 3 };
const sheet = buildCostSheet(plan, realCtx, T, G);
const day = (n: number) => sheet.days[n - 1];

test("the owner's group on real Master data: stays, rooms, meal plans, our lodges and city hotels", () => {
  assert.deepEqual(
    sheet.days.map((d) => [d.n, d.stay, d.meal, d.own_lodge, d.city_hotel]),
    [
      [1, "Roseate House", "CP", false, true], [2, "Iora Retreat", "AP", false, false], [3, "Iora Retreat", "AP", false, false], [4, "Iora Retreat", "AP", false, false],
      [5, "Roseate House", "CP", false, true], [6, "Kanha Earth Lodge", "AP", true, false], [7, "Kanha Earth Lodge", "AP", true, false], [8, "Kanha Earth Lodge", "AP", true, false],
      [9, "Kanha Earth Lodge", "AP", true, false], [10, "Waghoba Eco Lodge", "AP", true, false], [11, "Waghoba Eco Lodge", "AP", true, false], [12, "Waghoba Eco Lodge", "AP", true, false],
      [13, "Waghoba Eco Lodge", "AP", true, false], [14, "", "", false, false],
    ]
  );
  assert.deepEqual(sheet.missing, []);
});

test("rooms: single = one guest in a room, double = two, from the engine (GST included)", () => {
  const one = priceTrip(planToTrip({ ...plan, guest: { ...plan.guest, adults: 1, children: [], rooms: 1 }, offer_ids: [], markup_pct: 0, discount: null, adjustment: null, gst: null }, T), realCtx.pricing);
  const kel = one.lines.find((l) => l.kind === "room" && l.date === "2027-02-15")!;
  assert.equal(day(6).auto.single, kel.amount);
  // Roseate House: Rs 23,000 + 18% (single = double); Iora: single < double
  assert.deepEqual([day(1).auto.single, day(1).auto.double], [27140, 27140]);
  assert.ok(day(2).auto.single < day(2).auto.double);
  assert.equal(day(14).auto.single + day(14).auto.double, 0); // no night on the last day
});

test("per jeep on safari days, per vehicle on transfer days, flights per person on flight days", () => {
  for (const n of [3, 4, 7, 8, 9, 11, 12, 13]) assert.ok(day(n).auto.jeep > 0, `day ${n} jeep`);
  for (const n of [1, 2, 5, 6, 10, 14]) assert.equal(day(n).auto.jeep, 0, `day ${n} no safari`);
  for (const n of [1, 2, 5, 6, 10, 14]) assert.ok(day(n).auto.vehicle > 0, `day ${n} vehicle`);
  // flights Delhi - Guwahati, Guwahati - Delhi, Delhi - Jabalpur, Nagpur - Delhi: Rs 15,000 per person each
  assert.deepEqual([2, 5, 6, 14].map((n) => day(n).auto.person), [15000, 15000, 15000, 15000]);
  // a jeep's day costs more than nothing and is the same whatever the group size (one jeep)
  const big = buildCostSheet({ ...plan, guest: { ...plan.guest, adults: 14, rooms: 7 } }, realCtx, T, G);
  assert.deepEqual(big.days.map((d) => d.auto.jeep), sheet.days.map((d) => d.auto.jeep));
});

test("the ladder on the real sheet: cost per guest falls with a bigger group; a typed cell counts", () => {
  const g = { ...G, fx: 85, rows: [rowFor(G, 6, 1), rowFor(G, 8, 1), rowFor(G, 12, 2)] };
  const p = priceGroup(costSheet(plan, realCtx, T, g).days, g);
  assert.deepEqual(p.problems, []);
  assert.ok(p.rows[0].inr > p.rows[1].inr);
  const t = sheetTotals(costSheet(plan, realCtx, T, g).days);
  // 6 + 1 by hand: the formula
  const r = p.rows[0];
  const tl = t.single + t.person;
  assert.equal(r.inr, Math.round((t.double / 2 + t.person + t.group / 6 + (t.jeep * 3) / 6 + (t.vehicle * 3) / 6 + tl / 6) * 100) / 100);
  const edited = priceGroup(costSheet(plan, realCtx, T, { ...g, cells: { "2027-02-12": { jeep: day(3).auto.jeep + 6000 } } }).days, g);
  assert.equal(Math.round((edited.rows[0].inr - r.inr) * 100) / 100, 3000); // 6,000 x 3 jeeps / 6 guests
});
