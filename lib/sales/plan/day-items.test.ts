// Run with:  npx tsx --test lib/sales/plan/day-items.test.ts
// Plan & price, Manav's quote of 4 Nov 2026: the boat safari's price on the side panel was the
// base rate (Rs 10,000) while the costing charged the group-size price (Rs 14,000 for 2 guests);
// a Jorhat - Delhi flight added on the day of a planned Guwahati - Delhi flight made two flights home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addonBasePrice, withItem } from "./day-items";
import { realCtx } from "./real-fixture";
import type { PlanDay, PlanItem } from "./types";

const flight = (id: string, from: string, to: string, fare?: number): PlanItem => ({
  id, type: "flight", title: `Flight ${from} to ${to}`, detail: "", price: null, addon_id: null, qty: null,
  flight: { from, to, airline: "", number: "", time: "", pnr: "", ...(fare ? { fare_pp: fare } : {}) },
});
const day = (items: PlanItem[]) => ({ date: "2027-01-14", items } as unknown as PlanDay);

test("a flight for the same leg replaces the planned one; another flight is added", () => {
  const d = withItem(day([flight("a", "Guwahati", "Delhi")]), flight("b", "Jorhat", "Delhi", 15000));
  assert.deepEqual(d.items.map((x) => x.title), ["Flight Jorhat to Delhi"]);
  assert.equal(d.items[0].flight?.fare_pp, 15000);
  const out = withItem(day([flight("a", "Delhi", "Guwahati")]), flight("b", "Delhi", "Jorhat"));
  assert.deepEqual(out.items.map((x) => x.title), ["Flight Delhi to Jorhat"]);
  // a connecting flight (Delhi - Jabalpur after Jorhat - Delhi) is a second leg, kept
  const two = withItem(day([flight("a", "Jorhat", "Delhi")]), flight("b", "Delhi", "Jabalpur"));
  assert.equal(two.items.length, 2);
});

test("the boat safari is shown at the group-size price the costing charges", () => {
  const boat = realCtx.pricing.addons.find((a) => a.name === "Boat safari, 2 hours" && a.property_id === "H_denwa_backwater_escape")!;
  // the export has no tiers; Master data has 2 guests 14,000 / 4 guests 16,000 / 6 guests 19,000
  const tiered = { ...boat, tiers: [{ max_guests: 2, rate: 14000 }, { max_guests: 4, rate: 16000 }, { max_guests: 6, rate: 19000 }] };
  assert.deepEqual(addonBasePrice(tiered, { adults: 2, children: [], nationality: "foreign" }), { rate: 14000, groupOf: 2 });
  assert.deepEqual(addonBasePrice(tiered, { adults: 3, children: [4], nationality: "indian" }), { rate: 16000, groupOf: 3 });
  assert.deepEqual(addonBasePrice(tiered, { adults: 4, children: [8, 10], nationality: "indian" }), { rate: 19000, groupOf: 6 });
  // no tiers: the plain rate
  assert.deepEqual(addonBasePrice(boat, { adults: 2, children: [], nationality: "indian" }), { rate: 10000, groupOf: null });
});
