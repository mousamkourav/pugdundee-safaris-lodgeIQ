// Run with:  npx tsx --test lib/sales/plan/trip-generator.test.ts
// 320 trips made from the REAL Master data (trip-generator.ts: 1-6 lodges, city nights before / in the
// middle / after, flights between regions, own car, train, children, Indian / foreign, dates fixed or
// not), read by the built-in reader, planned and priced, each checked against the travel rule book by
// an independent judge. Every one must be clean. The full report (640 trips, the roads and rates
// genuinely missing in Master data): npx tsx scripts/trip-generator-report.ts 640
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeTrip, makeTrips, masterView } from "./trip-generator";
import { realCtx as ctx } from "./real-fixture";

test("320 generated trips on the real Master data: every one follows the rule book, is priced and adds up", () => {
  const mv = masterView(ctx);
  const trips = makeTrips(320, ctx);
  assert.equal(trips.length, 320);
  const bad = trips.map((t) => ({ t, v: judgeTrip(t, ctx, mv) })).filter(({ v }) => v.fails.length);
  assert.deepEqual(
    bad.slice(0, 5).map(({ t, v }) => `#${t.n} ${t.text}\n  ${v.fails.map((f) => `${f.kind}: ${f.detail}`).join("\n  ")}`),
    [],
    `${bad.length} of 320 trips fail`
  );
});

test("the generator covers what the owner asked for", () => {
  const trips = makeTrips(320, ctx);
  const has = (f: (t: (typeof trips)[number]) => boolean) => trips.some(f);
  const lodges = (t: (typeof trips)[number]) => t.places.filter((p) => p.kind === "lodge").length;
  for (let n = 1; n <= 6; n++) assert.ok(has((t) => lodges(t) === n), `${n} lodges`);
  for (const city of ["Delhi", "Agra", "Jaipur", "Khajuraho", "Siliguri"]) assert.ok(has((t) => t.places.some((p) => p.kind === "city" && p.city === city)), city);
  assert.ok(has((t) => t.places.some((p) => p.kind === "lodge" && p.name === "Iora Retreat")), "Kaziranga");
  assert.ok(has((t) => t.places[0].kind === "city") && has((t) => t.places[t.places.length - 1].kind === "city"), "city nights before and after");
  assert.ok(has((t) => t.places.slice(1, -1).some((p) => p.kind === "city")), "city nights in the middle");
  for (const mode of ["flight", "train", "own"] as const) assert.ok(has((t) => t.mode === mode), mode);
  assert.ok(has((t) => t.children.length > 0) && has((t) => t.nationality === "indian") && has((t) => t.nationality === "foreign"));
  assert.ok(has((t) => t.dateless) && has((t) => !t.dateless));
});
