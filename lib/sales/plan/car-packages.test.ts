// Outstation car packages on the owner's real Master data, with the packages and guides of
// sales_car_packages.sql (Delhi rate sheet, 2 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan, planToTrip } from "./planner";
import { markConfirmed } from "./confirm";
import { parseCities, findCarPackage } from "./car-packages";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { missingTransferPairs } from "@/lib/sales/master/missing-transfers";
import type { Addon, CarPackage } from "@/lib/sales/pricing/types";
import { realCtx } from "./real-fixture";
import { OWNER_FULL_TEST } from "./real-fixture";
import { REAL_MASTER as M } from "./real-master.data";
import type { BuilderContext, Plan } from "./types";

const TODAY = "2026-11-02";
const pkg = (id: string, route: string, nights: number, rate: number): CarPackage => ({ id, name: `${route} (${nights} night${nights === 1 ? "" : "s"} / ${nights + 1} days)`, cities: parseCities(route), nights, vehicle_type: "Innova / Crysta", capacity: 6, rate, tax_pct: 5, valid_from: null, valid_to: "2027-09-30", active: true });
const PACKAGES = [pkg("CP1", "Delhi - Agra - Delhi", 1, 21000), pkg("CP2", "Delhi - Agra - Delhi", 2, 25000), pkg("CP3", "Delhi - Agra - Jaipur - Delhi", 3, 40000), pkg("CP4", "Delhi - Agra - Jaipur - Delhi", 4, 50000)];
const hotels = realCtx.properties.filter((p) => /^(Courtyard by Marriott Agra|DoubleTree by Hilton Agra|ITC Mughal|ITC Rajputana)$/.test(p.name));
const guides: Addon[] = hotels.flatMap((h) => [
  { id: `G-${h.id}`, name: "Local guide, per day", property_id: h.id, pricing_unit: "per_group" as const, rate: 8000, tax_pct: 5, active: true },
  { id: `A-${h.id}`, name: "Accompanying guide, per day", property_id: h.id, pricing_unit: "per_group" as const, rate: 11000, tax_pct: 5, active: true },
]);
const ctx: BuilderContext = { ...realCtx, pricing: { ...realCtx.pricing, carPackages: PACKAGES, addons: [...realCtx.pricing.addons, ...guides] } };

function read(c: BuilderContext, ...msgs: string[]) {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, c, TODAY);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const price = (p: Plan, c: BuilderContext) => priceTrip(planToTrip(markConfirmed(p, TODAY), TODAY), c.pricing);
const pkgLines = (r: ReturnType<typeof priceTrip>) => r.lines.filter((l) => l.kind === "transfer" && /^Delhi - Agra/.test(l.description));

test("cities of a package are read from its route", () => {
  assert.deepEqual(parseCities("Delhi - Agra - Jaipur - Delhi"), ["Delhi", "Agra", "Jaipur", "Delhi"]);
  assert.deepEqual(parseCities("Delhi, Agra, Delhi"), ["Delhi", "Agra", "Delhi"]);
  assert.equal(findCarPackage(PACKAGES, ["Delhi", "Agra", "Delhi"], 2, "2027-01-20")!.id, "CP2");
  assert.equal(findCarPackage(PACKAGES, ["Delhi", "Agra", "Delhi"], 3, "2027-01-20"), null); // never guessed
  assert.equal(findCarPackage(PACKAGES, ["Delhi", "Jaipur", "Agra", "Delhi"], 3, "2027-01-20"), null); // another order
  assert.equal(findCarPackage(PACKAGES, ["Delhi", "Agra", "Delhi"], 1, "2027-10-20"), null); // after 30 Sep 2027
});

test("owner's whole circuit: Delhi - Agra 2 nights - Jaipur 2 nights - Delhi is the 4-night package, not three drives", () => {
  const P = read(ctx, OWNER_FULL_TEST);
  const r = price(P, ctx);
  const lines = pkgLines(r);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, "Delhi - Agra - Jaipur - Delhi (4 nights / 5 days) by Innova / Crysta (2 vehicles)"); // "2 gaadi for all transfers"
  assert.equal(lines[0].amount, 2 * 50000 * 1.05);
  // none of its drives is priced or asked for on its own
  assert.ok(!r.lines.some((l) => l.kind === "transfer" && /Agra|Rajputana/.test(l.description) && !/^Delhi - Agra/.test(l.description)));
  // the guides are priced; the sightseeing is by the package's car; only the Agra entrances... none asked
  assert.deepEqual(r.missing.map((m) => m.label).sort(), []);
  assert.ok(P.days.some((d) => d.items.some((i) => i.type === "note" && /^Agra sightseeing \(by the outstation car, in the package\)$/.test(i.title))));
  assert.ok(r.lines.some((l) => l.description.startsWith("Local guide, per day")));
});

test("after the lodges, fly to Delhi, Agra 1 night and back to Delhi: Rs 21,000; 2 nights in Agra: Rs 25,000", () => {
  const one = read(ctx, "2 adults indian, arriving delhi 10 jan 2027, 1 night delhi at roseate, fly to jabalpur, kings lodge 3 nights, then fly jabalpur to delhi and drive to agra 1 night at itc mughal, then drive back to delhi for the flight home");
  const r1 = price(one, ctx);
  assert.deepEqual(pkgLines(r1).map((l) => [l.description, l.amount]), [["Delhi - Agra - Delhi (1 night / 2 days) by Innova / Crysta", 22050]]);
  assert.deepEqual(r1.missing.filter((m) => m.kind === "transfer").map((m) => m.label), []);
  const two = read(ctx, "2 adults indian, arriving delhi 10 jan 2027, 1 night delhi at roseate, fly to jabalpur, kings lodge 3 nights, then fly jabalpur to delhi and drive to agra 2 nights at itc mughal, then drive back to delhi for the flight home");
  assert.deepEqual(pkgLines(price(two, ctx)).map((l) => l.amount), [26250]);
});

test("no package for the nights asked: each drive is priced on its own, with a note (never a guessed package)", () => {
  const p = read(ctx, "2 adults indian, arriving delhi 10 jan 2027, 1 night delhi at roseate, fly to jabalpur, kings lodge 3 nights, then fly jabalpur to delhi and drive to agra 3 nights at itc mughal, then drive back to delhi for the flight home");
  const r = price(p, ctx);
  assert.equal(pkgLines(r).length, 0);
  assert.ok(p.days.some((d) => d.notes.some((n) => n === "No outstation car package for Delhi - Agra - Delhi, 3 nights in Master data: each drive is priced on its own.")));
  assert.ok(r.missing.some((m) => m.kind === "transfer"));
});

test("without packages in Master data nothing changes (the drives are priced one by one)", () => {
  const P = read(realCtx, OWNER_FULL_TEST);
  assert.ok(!P.days.some((d) => d.items.some((i) => i.car_package_id)));
});

test("Missing transfer rates: roads on a package are not asked for", () => {
  const input = { properties: M.properties as never, locations: M.locations as never, rates: M.transferRates as never, quoteMisses: [], parks: [...M.parks] };
  const before = missingTransferPairs(input).filter((p) => p.kind === "city-city");
  const after = missingTransferPairs({ ...input, carPackages: PACKAGES }).filter((p) => p.kind === "city-city");
  assert.ok(before.length > 0);
  assert.deepEqual(after, []);
});
