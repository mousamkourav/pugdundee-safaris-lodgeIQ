// Run with:  npx tsx --test lib/sales/master/real-rate-audit.test.ts
// The Rate audit on the owner's REAL Master data (export of 5 Nov 2026), with the SQL files
// run since then applied the same way here: every row must be OK (owner, 3 Nov 2026). A row
// that is not is either a wrong rate in Master data (fix it with SQL) or a wrong line in
// rate-card.ts (fix the card), never left as a known false alarm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRates, type AuData, type AuAddon } from "./rate-audit";
import { REAL_MASTER as R } from "../plan/real-master.data";

type Row = Record<string, unknown>;
const NATURE_WALK = "Nature walk / cycling / night trail";

// supabase/sales_rates_fix_2026-11-03.sql and supabase/sales_rate_answers_2026-11-03.sql, as they change the rows
export function afterSql(addons: Row[], safaris: Row[]): { addons: Row[]; safaris: Row[] } {
  const a = addons.map((x) => ({ ...x }));
  const walk = a.find((x) => x.name === NATURE_WALK && x.property_id == null)!;
  for (const x of a) {
    if (/^safari breakfast \(outside jeeps\)/i.test(String(x.name))) Object.assign(x, { included_guests: 2, extra_guest_rate: 500 });
    if (x.property_id === "H_ken_river_lodge" && /^royal enfield/i.test(String(x.name))) Object.assign(x, { rate: 4000 });
    // the picnic is one Pugdundee experience (same id, so saved quotes keep it)
    if (x.property_id === "H_kanha_earth_lodge" && x.name === "Banjar River picnic")
      Object.assign(x, { name: "Picnic lunch", property_id: null, rate: 4000, tax_pct: 18, offered_at: walk.offered_at });
    if (x.property_id === "H_pench_tree_lodge" && x.name === "Runi Jhuni walking trail") Object.assign(x, { name: "Buffer walk (Runi Jhuni walking trail)" });
  }
  a.push({ id: "new-kanha-walk", name: "Buffer walk", property_id: "H_kanha_earth_lodge", park_id: null, pricing_unit: "per_person", rate: 3000, rate_foreign: null, tax_pct: 5, active: true, min_guests: 2 });
  a.push({ id: "new-culinary", name: "Culinary workshop", property_id: null, park_id: null, pricing_unit: "per_person", rate: 2500, rate_foreign: null, tax_pct: 5, active: true, min_guests: 2, offered_at: walk.offered_at });
  const s = safaris.map((x) => ({ ...x }));
  for (const x of s)
    if (x.park_id === "P_tadoba_andhari_tiger_reserve" && x.zone === "core" && x.nationality === "indian" && x.weekday_rate === 14000 && x.book_min_days == null)
      Object.assign(x, { book_min_days: 60, book_max_days: 120 });
  return { addons: a, safaris: s };
}

// supabase/sales_management_rates_2026-11-04.sql (management's rates sheet), as it changes the rows
const INDIAN_4NOV: [string, string, number, number, number, number][] = [
  ["C_cottage", "shoulder", 16000, 13000, 17000, 14000], ["C_cottage", "high", 19500, 16500, 20500, 17500], ["C_cottage", "peak", 22000, 18500, 22000, 18500],
  ["C_deluxe_room", "shoulder", 14000, 11000, 15000, 12000], ["C_deluxe_room", "high", 23500, 20000, 25000, 21000], ["C_deluxe_room", "peak", 18000, 15000, 18000, 15000],
  ["C_forest_suite", "shoulder", 20500, 17000, 22000, 18000], ["C_forest_suite", "high", 23500, 20000, 25000, 21000], ["C_forest_suite", "peak", 26000, 22000, 26000, 22000],
  ["C_tree_house", "shoulder", 18500, 15500, 20000, 16500], ["C_tree_house", "high", 22000, 19000, 23500, 20000], ["C_tree_house", "peak", 25000, 21000, 25000, 21000],
];
export const INDIAN_CALENDAR_4NOV: [string, string, string][] = [
  ["shoulder", "2026-10-01", "2026-10-31"], ["peak", "2026-10-17", "2026-10-20"], ["high", "2026-11-01", "2026-11-30"], ["peak", "2026-11-06", "2026-11-14"],
  ["shoulder", "2026-12-01", "2026-12-20"], ["peak", "2026-12-21", "2027-01-04"], ["shoulder", "2027-01-05", "2027-01-31"], ["high", "2027-02-01", "2027-05-15"],
  ["peak", "2027-03-19", "2027-03-22"], ["shoulder", "2027-05-16", "2027-06-30"],
];
const TRANSFERS_4NOV: Record<string, number> = {
  "f9bf85e6-07d0-4278-846e-4e216c2b681d": 7500, "c71cc745-46f4-4862-89dd-25cb98339222": 3000, "eedfceab-f14d-4673-9f41-39a05e2d57cc": 2500,
  "b4acf44a-6a86-4b3b-abef-d565bbb86d2f": 7000, "65332951-5773-4880-a3a5-fb0d08535fa1": 8000,
};
export function afterSql4Nov(m: Record<string, Row[]>): { tariff: Row[]; calendar: Row[]; safaris: Row[]; transfers: Row[] } {
  const base = m.tariff.find((t) => t.nationality === "indian")!;
  const tariff = [
    ...m.tariff.filter((t) => t.nationality !== "indian"),
    ...INDIAN_4NOV.map(([cat, season, dbl, sgl, wd, ws], i) => ({ ...base, id: `in-${i}`, rate_category_id: cat, season, rate_double: dbl, rate_single: sgl, weekend_rate_double: wd, weekend_rate_single: ws, weekend_days: [5, 6], active: true })),
  ];
  const calendar = [
    ...m.calendar.map((c) =>
      c.calendar === "pugdundee" && c.date_from === "2027-02-01" ? { ...c, date_to: "2027-03-10" } : c.calendar === "pugdundee" && c.date_from === "2027-03-10" ? { ...c, date_from: "2027-03-11" } : c
    ),
    ...INDIAN_CALENDAR_4NOV.map(([season, date_from, date_to]) => ({ calendar: "pugdundee", nationality: "indian", season, date_from, date_to, active: true })),
  ];
  const safaris = m.safariRates.map((x) => (x.book_min_days === 4 && x.book_max_days === 59 ? { ...x, book_min_days: 1 } : x));
  const transfers = m.transferRates.map((t) => (TRANSFERS_4NOV[String(t.id)] ? { ...t, rate: TRANSFERS_4NOV[String(t.id)] } : t));
  return { tariff, calendar, safaris, transfers };
}

// The export of 2 Nov 2026 does not carry Ken River's long-weekend rows the way the audit reads
// them (the live audit shows those rows OK): every other row is checked.
const CHECKED = (r: { item: string }) => !/^Ken River Lodge: /.test(r.item);
// the export names the calendars as the screen shows them
const CAL: Record<string, string> = { "Pugdundee lodges": "pugdundee", "Ken River Lodge (long weekends)": "krl" };

// supabase/sales_roseate_2026_11_08.sql: Roseate House B&B to 31 Mar 2027, 23,000 -> 19,500 (+ 18%)
const roseate8Nov = (rows: Row[]) =>
  rows.map((r) =>
    r.room_category_id === "R_roseate_house_ac_deluxe" && String(r.valid_from) <= "2027-01-15" && String(r.valid_to) >= "2027-01-15" && /^(CP|B&B|BB)$/i.test(String(r.meal_plan))
      ? { ...r, rate_double: r.rate_double === 23000 ? 19500 : r.rate_double, rate_single: r.rate_single === 23000 ? 19500 : r.rate_single }
      : r
  );

const data = (sql: boolean): AuData => {
  const m = R as unknown as Record<string, Row[]>;
  // the export of 2 Nov has no price tiers; Master data has these (the live audit shows them OK)
  const tiered = m.addons.map((x) =>
    x.name === "Boat safari, 2 hours" && x.property_id === "H_denwa_backwater_escape" ? { ...x, tiers: [{ max_guests: 2, rate: 14000 }, { max_guests: 4, rate: 16000 }, { max_guests: 6, rate: 19000 }] } : x
  );
  const m0 = { ...m, calendar: m.calendar.map((c) => ({ ...c, calendar: CAL[String(c.calendar)] ?? c.calendar, active: true })), tariff: m.tariff.map((t) => ({ ...t, active: true })) };
  const { addons, safaris: s1 } = sql ? afterSql(tiered, m.safariRates) : { addons: tiered, safaris: m.safariRates };
  const later = sql ? afterSql4Nov({ ...m0, safariRates: s1 }) : { tariff: m0.tariff, calendar: m0.calendar, safaris: s1, transfers: m.transferRates };
  return {
    properties: m.properties as never,
    locations: m.locations as never,
    rooms: m.rooms as never,
    roomRates: (sql ? roseate8Nov(m.roomRates) : m.roomRates) as never,
    transfers: later.transfers as never,
    addons: addons as unknown as AuAddon[],
    parks: m.parks as never,
    safaris: later.safaris as never,
    tariff: later.tariff as never,
    // the export keeps a category's name in its id (C_tree_house = Tree House)
    categories: m.categories.map((c) => ({ ...c, calendar: CAL[String(c.calendar)] ?? c.calendar, name: String(c.id).replace(/^C_/, "").replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()) })) as never,
    calendar: later.calendar as never,
  };
};

test("real Master data: every Rate audit row is OK once the SQL of 3, 4 and 8 Nov 2026 is run", () => {
  const bad = auditRates(data(true)).filter((r) => CHECKED(r) && r.status !== "ok");
  assert.deepEqual(bad.map((r) => `${r.item}: ${r.status} (${r.expected} / ${r.found})`), []);
});

// The 5 Nov 2026 export was taken after the owner ran the SQL of 3 and 4 Nov: the export itself has
// every row those files correct, so nothing is flagged even without applying them here.
// (8 Nov 2026: Roseate House is 19,500 + 18% to 31 Mar 2027; the export still says 23,000 until
// supabase/sales_roseate_2026_11_08.sql runs, so that one row is flagged)
test("real Master data (5 Nov export): the SQL of 3 and 4 Nov is already in it; only Roseate House waits for the SQL of 8 Nov", () => {
  const bad = auditRates(data(false)).filter((r) => CHECKED(r) && r.status !== "ok").map((r) => r.item).sort();
  assert.deepEqual(bad, ["Roseate House, CP, 2027-03 (to 2027-03-31)"]);
});

// The experiences the owner asked for are found where they are sold (no "not offered" note)
test("after the SQL: buffer walk at Kanha and Pench, culinary workshop and picnic lunch at our lodges", async () => {
  const { realCtx } = await import("../plan/real-fixture");
  const { findAddon } = await import("../plan/planner");
  const m = R as unknown as Record<string, Row[]>;
  const ctx = { ...realCtx, pricing: { ...realCtx.pricing, addons: afterSql(m.addons, m.safariRates).addons as never } };
  const at = (lodge: string, k: string) => findAddon(ctx, realCtx.properties.find((p) => p.name.startsWith(lodge))!.id, k)?.name ?? null;
  assert.equal(at("Kanha", "buffer walk"), "Buffer walk");
  assert.equal(at("Pench", "buffer walk"), "Buffer walk (Runi Jhuni walking trail)");
  assert.equal(at("Denwa", "buffer walk"), "Walking safari in buffer zone");
  for (const lodge of ["Kanha", "Pench", "Kings", "Waghoba", "Denwa", "Tree House"]) {
    assert.equal(at(lodge, "culinary"), "Culinary workshop", lodge);
    assert.equal(at(lodge, "picnic"), "Picnic lunch", lodge);
  }
  // Ken River sells by its own B2B sheet: neither is offered there
  assert.equal(at("Ken River", "culinary"), null);
});
