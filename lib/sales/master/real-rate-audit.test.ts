// Run with:  npx tsx --test lib/sales/master/real-rate-audit.test.ts
// The Rate audit on the owner's REAL Master data (export of 2 Nov 2026), with the SQL files
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

// The export of 2 Nov 2026 does not carry the tariff, season calendar or Ken River long-weekend
// fields the way the audit reads them (the live audit shows those rows OK), so this test checks
// the road transfers, safaris and experiences: the rows the documents and the SQL touch.
const CHECKED = (r: { item: string }) => !/^(Cottage|Tree House|Forest Suite|Deluxe Room|Season calendar|Ken River Lodge: )/.test(r.item);

const data = (sql: boolean): AuData => {
  const m = R as unknown as Record<string, Row[]>;
  // the export of 2 Nov has no price tiers; Master data has these (the live audit shows them OK)
  const tiered = m.addons.map((x) =>
    x.name === "Boat safari, 2 hours" && x.property_id === "H_denwa_backwater_escape" ? { ...x, tiers: [{ max_guests: 2, rate: 14000 }, { max_guests: 4, rate: 16000 }, { max_guests: 6, rate: 19000 }] } : x
  );
  const { addons, safaris } = sql ? afterSql(tiered, m.safariRates) : { addons: tiered, safaris: m.safariRates };
  return {
    properties: m.properties as never,
    locations: m.locations as never,
    rooms: m.rooms as never,
    roomRates: m.roomRates as never,
    transfers: m.transferRates as never,
    addons: addons as unknown as AuAddon[],
    parks: m.parks as never,
    safaris: safaris as never,
    tariff: m.tariff as never,
    // the export keeps a category's name in its id (C_tree_house = Tree House)
    categories: m.categories.map((c) => ({ ...c, name: String(c.id).replace(/^C_/, "").replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()) })) as never,
    calendar: m.calendar as never,
  };
};

test("real Master data: every Rate audit row is OK once the SQL of 3 Nov 2026 is run", () => {
  const bad = auditRates(data(true)).filter((r) => CHECKED(r) && r.status !== "ok");
  assert.deepEqual(bad.map((r) => `${r.item}: ${r.status} (${r.expected} / ${r.found})`), []);
});

test("real Master data before the SQL: only the rows the SQL corrects are flagged", () => {
  const bad = auditRates(data(false)).filter((r) => CHECKED(r) && r.status !== "ok").map((r) => r.item).sort();
  assert.deepEqual(bad, [
    "General: Culinary workshop",
    "General: Safari breakfast (outside jeeps), up to 2 guests at all lodges",
    "Kanha Earth Lodge: Buffer walk",
    "Ken River: Royal Enfield (per day)",
    "Tadoba core, indian, booked 60-120 days ahead, evening",
    "Tadoba core, indian, booked 60-120 days ahead, morning",
    "General: Picnic lunch at Kanha Earth Lodge",
  ].sort());
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
