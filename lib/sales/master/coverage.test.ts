// Rate coverage: every price a quote can need, priced with the engine; the gaps listed.
// Run with:  npx tsx --test lib/sales/master/coverage.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rateCoverage, sampleDates, seasonMonths } from "./coverage";
import { citiesCtx } from "@/lib/sales/plan/reader-fixture";

const d = citiesCtx.pricing;

test("the months checked run to the end of the season being sold (30 Sep)", () => {
  assert.equal(seasonMonths("2026-11-01"), 11); // Nov 2026 - Sep 2027
  assert.equal(seasonMonths("2027-04-10"), 18); // from April, the next season too: to Sep 2028
  assert.deepEqual(sampleDates("2026-11-20", 2), ["2026-12-15", "2027-01-15"]);
});

test("every gap a quote would meet is listed: naturalist, full-day safari, child rate", () => {
  const out = rateCoverage(d, "2026-11-01");
  const has = (area: string, item: RegExp) => out.some((i) => i.area === area && item.test(i.item));
  // rooms and safaris have rates for the whole season in the test data: none listed
  assert.ok(!out.some((i) => i.area === "Accommodation" || i.area === "Safari"));
  // no naturalist fee or add-on in the test data
  assert.ok(has("Naturalist", /^Kanha National Park$/));
  // Tadoba has a full-day rate; Bandhavgarh has neither a rate nor a lodge add-on
  assert.ok(has("Full-day safari", /^Bandhavgarh National Park: full-day safari \(Indian and foreign guests\)$/));
  assert.ok(!has("Full-day safari", /^Tadoba/));
  // a hotel with no child rate charges a child nothing: listed
  assert.ok(has("Child rate", /^Roseate House - AC Deluxe$/));
});

test("a missing month, a lodge add-on for full-day safaris and a naturalist included in the safari", () => {
  // Kanha Earth Lodge's rates end on 31 Mar 2027
  const shorter = { ...d, roomRates: d.roomRates.map((r) => (r.room_category_id === "KEL_C" ? { ...r, valid_to: "2027-03-31" } : r)) };
  const out = rateCoverage(shorter, "2026-11-01");
  assert.ok(out.some((i) => i.item === "Kanha Earth Lodge - Cottage (Indian and foreign guests)" && i.detail === "no rate for Apr 2027 - Sep 2027"));
  // a full-day add-on at Kings Lodge covers Bandhavgarh; "naturalist included" on Kaziranga's rates covers it
  const fixed = {
    ...d,
    addons: [...d.addons, { id: "FD", name: "Full-day safari (up to 3 guests)", property_id: "KL", pricing_unit: "per_vehicle" as const, rate: 60000, tax_pct: 0, active: true }],
    safariRates: d.safariRates.map((r) => (r.park_id === "KAZ" ? { ...r, includes_naturalist: true } : r)),
  };
  const after = rateCoverage(fixed, "2026-11-01");
  assert.ok(!after.some((i) => i.area === "Full-day safari" && /^Bandhavgarh/.test(i.item)));
  assert.ok(!after.some((i) => i.area === "Naturalist" && i.item === "Kaziranga National Park"));
});
