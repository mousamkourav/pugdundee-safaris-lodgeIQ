// Run with:  npx tsx --test lib/sales/group/costing.test.ts
// The group costing, checked against the owner's Excel (6 Nov 2026: Delhi - Kaziranga - Delhi -
// Kanha - Tadoba - Delhi, 15 days): the day costs, the totals, every row of the group-size ladder
// (6+1 ... 14+2, to the rupee), the tour leaders' cost, the single room supplement, then the
// tour leader options, dollars, markup and rounding, and the checks on what the browser sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCells, defaultGroup, groupBooking, groupTotalInr, toGuest, type GroupSaved, ladderRow, priceGroup, rowFor, roundUp, sanitizeGroup, sheetTotals, tourLeaderCost, type CostDay, type CostKind } from "./costing";

// the sheet: [stay, own lodge, single, double, jeep, vehicle, person]
const SHEET: [string, boolean, number, number, number, number, number][] = [
  ["Roseate House", false, 23000, 23000, 0, 0, 3000],
  ["Iora Retreat", false, 12000, 16000, 0, 17000, 15000],
  ["Iora Retreat", false, 12000, 16000, 30000, 0, 1000],
  ["Iora Retreat", false, 12000, 16000, 30000, 0, 1000],
  ["Roseate House", false, 23000, 23000, 0, 17000, 15000],
  ["Kanha Earth Lodge", true, 21240, 24780, 0, 13500, 15000],
  ["Kanha Earth Lodge", true, 21240, 24780, 42000, 0, 0],
  ["Kanha Earth Lodge", true, 21240, 24780, 39375, 0, 0],
  ["Kanha Earth Lodge", true, 21240, 24780, 42000, 0, 0],
  ["Waghoba Eco Lodge", true, 21240, 24780, 0, 16800, 0],
  ["Waghoba Eco Lodge", true, 21240, 24780, 54600, 0, 0],
  ["Waghoba Eco Lodge", true, 21240, 24780, 54600, 0, 0],
  ["Waghoba Eco Lodge", true, 21240, 24780, 46200, 0, 0],
  ["Roseate House", false, 23000, 23000, 0, 12450, 15000],
  ["", false, 0, 0, 0, 0, 3000],
];
const days = (cells = {}): CostDay[] =>
  applyCells(
    SHEET.map(([stay, own, single, double, jeep, vehicle, person], i) => ({
      key: `d${i + 1}`, n: i + 1, date: null, title: "", stay, category: "", meal: "", own_lodge: own, city_hotel: stay === "Roseate House",
      auto: { single, double, jeep, vehicle, person, group: 0 } as Record<CostKind, number>,
    })),
    cells
  );
const G = { ...defaultGroup(), fx: 80.95, round_to: 0 };

test("the sheet's totals: single 2,74,920, double 3,15,240, safaris 3,38,775, Innova 76,750, per person 68,000", () => {
  const t = sheetTotals(days());
  assert.deepEqual([t.single, t.double, t.jeep, t.vehicle, t.person, t.group], [274920, 315240, 338775, 76750, 68000, 0]);
});

test("tour leaders: one in a single room 3,42,920; two sharing a double 4,51,240 (the sheet's 'Luis Solano TL')", () => {
  const t = sheetTotals(days());
  assert.equal(tourLeaderCost(t, 1, "single", "divided"), 342920);
  assert.equal(tourLeaderCost(t, 2, "share", "divided"), 451240);
  assert.equal(tourLeaderCost(t, 2, "single", "divided"), 685840);
  assert.equal(tourLeaderCost(t, 3, "share", "divided"), 451240 + 342920);
  assert.equal(tourLeaderCost(t, 0, "single", "divided"), 0);
});

test("every row of the sheet's ladder, to the rupee (jeeps and vehicles as the sheet has them)", () => {
  const t = sheetTotals(days());
  const g = { ...G, tl_room: "share" as const };
  // [paying, tour leaders, jeeps, vehicles, the sheet's cost per guest]
  const ROWS: [number, number, number, number, number][] = [
    [6, 1, 3, 3, 490535.83], [8, 1, 4, 3, 466654], [8, 2, 4, 4, 489788], [8, 2, 5, 4, 532134], [9, 2, 5, 4, 498077], [10, 2, 5, 5, 478507],
    [11, 2, 5, 5, 455517], [11, 2, 6, 5, 486315], [12, 1, 6, 5, 455563], [12, 2, 7, 5, 492821], [14, 1, 7, 5, 446913], [14, 2, 8, 6, 484330],
  ];
  for (const [paying, tls, jeeps, vehicles, want] of ROWS) {
    const r = ladderRow(t, g, { paying, tls, jeeps, vehicles });
    assert.equal(Number.isInteger(want) ? Math.round(r.inr) : r.inr, want, `${paying}+${tls} (${jeeps} jeeps, ${vehicles} vehicles)`);
  }
  // the sheet's dollars (rate about 80.95): 6,060 / 5,765 / 6,153
  assert.deepEqual([[6, 1, 3, 3], [8, 1, 4, 3], [9, 2, 5, 4]].map(([p, tl, j, v]) => Math.round(ladderRow(t, g, { paying: p, tls: tl, jeeps: j, vehicles: v }).usd!)), [6060, 5765, 6153]);
});

test("the default jeeps and vehicles: guests per jeep for the paying guests, people per vehicle for everyone", () => {
  const g = { ...defaultGroup(), per_jeep: 2, per_vehicle: 3 };
  // the sheet's usual counts: 6+1 = 3 jeeps 3 vehicles, 8+1 = 4 / 3, 8+2 = 4 / 4, 12+1 = 6 / 5, 14+2 = 7 / 6
  assert.deepEqual([[6, 1], [8, 1], [8, 2], [12, 1], [14, 2]].map(([p, t]) => { const r = rowFor(g, p, t); return [r.jeeps, r.vehicles]; }), [[3, 3], [4, 3], [4, 4], [6, 5], [7, 6]]);
  assert.deepEqual(rowFor({ per_jeep: 4, per_vehicle: 6 }, 7, 1), { paying: 7, tls: 1, jeeps: 2, vehicles: 2 });
});

test("single room supplement: single - double / 2 = 1,17,300 (the sheet's SRS); $1,449 -> $1,450", () => {
  const p = priceGroup(days(), { ...G, round_to: 50 });
  assert.equal(p.single_supplement.inr, 117300);
  assert.equal(p.single_supplement.usd, 1449.04);
  assert.equal(p.single_supplement.sell, 1450);
  // an extra night in Delhi (pre / post): Roseate House per guest sharing and single
  assert.deepEqual([p.extra_night?.name, p.extra_night?.inr_sharing, p.extra_night?.inr_single], ["Roseate House", 11500, 23000]);
});

test("tour leader options: free at our own lodges (Kanha, Tadoba), the rest divided; or all free", () => {
  const t = sheetTotals(days());
  // our lodges: 8 nights single 21,240 = 1,69,920; their per-person items 15,000 (the Jabalpur flight day at Kanha)
  assert.equal(tourLeaderCost(t, 1, "single", "own_lodges_free"), 342920 - 169920 - 15000);
  assert.equal(tourLeaderCost(t, 1, "single", "free"), 0);
  const divided = ladderRow(t, G, { paying: 6, tls: 1, jeeps: 3, vehicles: 3 }).inr;
  const free = ladderRow(t, { ...G, tl_cost: "free" }, { paying: 6, tls: 1, jeeps: 3, vehicles: 3 }).inr;
  assert.equal(Math.round((divided - free) * 6), 342920);
});

test("dollars: markup and rounding up; a selling price typed per row wins; no rate = asked", () => {
  const t = sheetTotals(days());
  const r = ladderRow(t, { ...G, markup_pct: 4, round_to: 100 }, { paying: 6, tls: 1, jeeps: 3, vehicles: 3 });
  assert.equal(r.usd, 6059.74);
  assert.equal(r.sell, 6400); // 6,059.74 x 1.04 = 6,302.13 -> 6,400
  assert.equal(ladderRow(t, { ...G, round_to: 50 }, { paying: 6, tls: 1, jeeps: 3, vehicles: 3 }).sell, 6100);
  const typed = ladderRow(t, G, { paying: 6, tls: 1, jeeps: 3, vehicles: 3, sell_usd: 6300 });
  assert.deepEqual([typed.sell, typed.typed, typed.margin], [6300, true, 240.26]);
  assert.deepEqual(priceGroup(days(), { ...G, fx: null }).problems, ["Type the US dollar rate (rupees per dollar)."]);
  assert.equal(roundUp(6000, 50), 6000);
  assert.equal(roundUp(6000.01, 50), 6050);
});

test("a cost changed by hand counts; the Master data figure stays visible; junk is refused", () => {
  const d = days({ d7: { jeep: 45000 }, d2: { double: -5, single: 12000 } });
  assert.equal(d[6].cost.jeep, 45000);
  assert.equal(d[6].auto.jeep, 42000);
  assert.deepEqual(d[6].edited, ["jeep"]);
  assert.equal(d[1].cost.double, 16000); // a negative is ignored
  assert.deepEqual(d[1].edited, []); // same as Master data
  assert.equal(sheetTotals(d).jeep, 338775 + 3000);
  const g = sanitizeGroup({ paying: "8", tls: 2, tl_room: "share", tl_cost: "hack", per_jeep: 0, fx: "80.95", rows: [{ paying: 8, tls: 2, jeeps: 4, vehicles: 4, sell_usd: "abc" }], cells: { d3: { jeep: "31000", x: 5 }, "drop table": { jeep: 1 } } })!;
  assert.deepEqual([g.paying, g.tls, g.tl_room, g.tl_cost, g.per_jeep, g.fx], [8, 2, "share", "divided", 1, 80.95]);
  assert.deepEqual(g.rows, [{ paying: 8, tls: 2, jeeps: 4, vehicles: 4, sell_usd: null }]);
  assert.deepEqual(g.cells, { d3: { jeep: 31000 } });
  assert.equal(sanitizeGroup("nope"), null);
});

// ---------------------------------------------------------------- saved quote: lists, guest page, Payments

const SAVED: GroupSaved = {
  fx: 85,
  tls: 1,
  tl_room: "single",
  rows: [
    { paying: 6, tls: 1, jeeps: 3, vehicles: 3, inr: 490535.83, usd: 5770.07, sell: 5800 },
    { paying: 8, tls: 1, jeeps: 4, vehicles: 3, inr: 450000, usd: 5294.12, sell: 5300 },
  ],
  single_supplement: 1450,
  extra_night: { name: "Roseate House", sharing: 140, single: 280 },
};

test("a saved group: the list value, the guest's view (no cost) and the booking in US dollars", () => {
  // list value: 5800 x 6 guests x Rs 85
  assert.equal(groupTotalInr(SAVED), 2958000);
  assert.equal(groupTotalInr({ ...SAVED, fx: null }), 0);
  assert.equal(groupTotalInr({ ...SAVED, rows: [{ ...SAVED.rows[0], sell: null }] }), 0);
  // the guest never gets a cost
  const g = toGuest(SAVED);
  assert.deepEqual(g.rows, [{ paying: 6, tls: 1, sell: 5800 }, { paying: 8, tls: 1, sell: 5300 }]);
  assert.ok(!/inr|usd|490535|5770|jeeps|vehicles|fx/.test(JSON.stringify(g)), JSON.stringify(g));
  // Payments: first row by default; 25 / 25 / 50; the dues add up to the total to the cent
  const pcts = [{ label: "Deposit", pct: 25 }, { label: "Second deposit", pct: 25 }, { label: "Final balance", pct: 50 }];
  const b = groupBooking(SAVED, pcts)!;
  assert.equal(b.total, 34800);
  assert.deepEqual(b.dues.map((d) => d.amount), [8700, 8700, 17400]);
  assert.equal(b.label, "Group 6 + 1");
  // the 8 + 1 row with 2 single rooms: 5300 x 8 + 1450 x 2
  const b2 = groupBooking(SAVED, pcts, 1, 2)!;
  assert.equal(b2.total, 45300);
  assert.equal(b2.label, "Group 8 + 1, 2 single rooms");
  // thirds of an odd total: the last due takes the cents
  const b3 = groupBooking({ ...SAVED, rows: [{ ...SAVED.rows[0], paying: 7, sell: 1001 }] }, [{ label: "A", pct: 33.3333 }, { label: "B", pct: 33.3333 }, { label: "C", pct: 33.3334 }])!;
  assert.equal(b3.total, 7007);
  assert.equal(Math.round(b3.dues.reduce((t, d) => t + d.amount, 0) * 100) / 100, 7007);
  // a missing price: no booking amounts invented
  assert.equal(groupBooking({ ...SAVED, rows: [{ ...SAVED.rows[0], sell: null }] }, pcts), null);
  assert.equal(groupBooking({ ...SAVED, single_supplement: null }, pcts, 0, 1), null);
  // an unknown row falls back to the first
  assert.equal(groupBooking(SAVED, pcts, 9)!.total, 34800);
});
