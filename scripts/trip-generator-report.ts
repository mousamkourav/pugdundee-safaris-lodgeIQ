// Prints the trip generator's summary: npx tsx scripts/trip-generator-report.ts [count] [show]
import { makeTrips, judgeTrip, masterView } from "@/lib/sales/plan/trip-generator";
import { realCtx as ctx } from "@/lib/sales/plan/real-fixture";
const count = Number(process.argv[2] ?? 320);
const show = Number(process.argv[3] ?? 2);
const mv = masterView(ctx);
const byKind = new Map<string, { trips: Set<number>; ex: string[] }>();
const roads = new Map<string, number>();
const rates = new Map<string, number>();
let bad = 0;
for (const spec of makeTrips(count, ctx)) {
  const v = judgeTrip(spec, ctx, mv);
  if (v.fails.length) bad++;
  for (const f of v.fails) {
    const k = byKind.get(f.kind) ?? { trips: new Set(), ex: [] };
    if (!k.trips.has(spec.n) && k.ex.length < show) k.ex.push(`#${spec.n} ${spec.text}\n      -> ${f.detail}`);
    k.trips.add(spec.n);
    byKind.set(f.kind, k);
  }
  for (const r of v.missingRates) { const k = r.replace(/ on d{4}-(d{2})-d{2}/, " in month $1"); rates.set(k, (rates.get(k) ?? 0) + 1); }
  for (const r of v.missingRoads) roads.set(r.split(" - ").sort().join(" - "), (roads.get(r.split(" - ").sort().join(" - ")) ?? 0) + 1);
}
console.log(`${count} trips: ${bad} with at least one failure, ${count - bad} clean`);
for (const [k, v] of [...byKind].sort((a, b) => b[1].trips.size - a[1].trips.size)) {
  console.log(`\n${v.trips.size.toString().padStart(4)}  ${k}`);
  for (const e of v.ex) console.log(`    ${e}`);
}
console.log(`\nRoads with no rate in Master data (genuinely missing), trips using them:`);
for (const [r, n] of [...roads].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${r}`);
console.log(`
Rooms with no rate for the night in Master data:`);
for (const [r, n] of [...rates].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(3)}  ${r}`);
