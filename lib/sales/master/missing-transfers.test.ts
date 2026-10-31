// Missing transfer rates (Master data) and the engine using a road both ways.
// Run with:  npx tsx --test lib/sales/master/missing-transfers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { TripInput } from "@/lib/sales/pricing/types";
import { readerCtx as ctx } from "@/lib/sales/plan/reader-fixture";
import { hasRoad, missingTransferPairs, quoteMissesOf } from "./missing-transfers";

const rates = ctx.pricing.transferRates;
const input = (quoteMisses: { from: string; to: string; price?: number | null }[] = []) => ({ properties: ctx.properties, locations: ctx.locations, rates, quoteMisses });
const roads = (pairs: ReturnType<typeof missingTransferPairs>) => pairs.map((p) => `${p.from_id}-${p.to_id}`);

test("every pair of our lodges without a road is listed once, whichever direction has a rate", () => {
  const pairs = missingTransferPairs(input()).filter((p) => p.kind === "lodge-lodge");
  // Kanha Earth Lodge <-> Kings Lodge has a rate: not listed in either direction
  assert.ok(!roads(pairs).some((r) => r === "L_KEL-L_KL" || r === "L_KL-L_KEL"));
  // Kings Lodge <-> Tree House Hideaway has none: listed once
  assert.equal(roads(pairs).filter((r) => r === "L_KL-L_THH" || r === "L_THH-L_KL").length, 1);
  // a partner lodge (Iora, Kaziranga) is not driven to from Central India
  assert.ok(!roads(pairs).some((r) => r.includes("L_IORA")));
  // 7 own lodges = 21 roads, minus the 5 in the fixture between own lodges
  assert.equal(pairs.length, 21 - 5);
});

test("a park's airport or station is needed for each of its lodges", () => {
  const pairs = roads(missingTransferPairs(input()).filter((p) => p.kind === "lodge-place"));
  // Jabalpur has a rate to Kings Lodge: Tree House Hideaway (same park) needs one too
  assert.ok(pairs.includes("JLR-L_THH"));
  // Katni has a rate to Tree House Hideaway: Kings Lodge needs one too
  assert.ok(pairs.includes("KTE-L_KL"));
  // Raipur is a Kanha gateway only: not listed for Bandhavgarh
  assert.ok(!pairs.some((r) => r.startsWith("RPR-L_KL") || r.startsWith("RPR-L_THH")));
});

test("roads the saved quotes needed come first, counted both ways, with the last price typed", () => {
  const misses = quoteMissesOf([
    { missing: [{ kind: "transfer", key: "transfer|2027-01-16|L_KEL|L_DBE" }], manual: { "transfer|2027-01-16|L_KEL|L_DBE": 15000 } },
    { missing: [{ kind: "transfer", key: "transfer|2027-02-02|L_DBE|L_KEL" }, { kind: "room", key: "room|x" }], manual: { "transfer|2027-02-02|L_DBE|L_KEL": 16000 } },
    { missing: [{ kind: "transfer", key: "transfer|2027-03-01|@hotel in Delhi|DEL" }] }, // a place not in master data
  ]);
  const pairs = missingTransferPairs(input(misses));
  assert.deepEqual([pairs[0].from_name, pairs[0].to_name, pairs[0].needed, pairs[0].last_price], ["Kanha Earth Lodge", "Denwa Backwater Escape", 2, 16000]);
  assert.ok(!pairs.some((p) => p.from_id.startsWith("@") || p.to_id.startsWith("@")));
});

test("the engine uses every road in both directions (Denwa -> Kanha and Kanha -> Denwa)", () => {
  // the fixture's one-direction rates, plus a road entered only one way (not marked both ways)
  const pricing = { ...ctx.pricing, transferRates: [...rates, { ...rates[0], id: "ONEWAY", from_location_id: "L_DBE", to_location_id: "L_KEL", bidirectional: false }] };
  const trip = (from: string, to: string): TripInput => ({ adults: 2, children: [], nationality: "indian", stays: [], safaris: [], transfers: [{ date: "2027-01-16", from_location_id: from, to_location_id: to }], booking_date: "2026-10-27" });
  for (const r of pricing.transferRates) {
    for (const [a, b] of [[r.from_location_id, r.to_location_id], [r.to_location_id, r.from_location_id]]) {
      const res = priceTrip(trip(a, b), pricing);
      assert.deepEqual(res.missing, [], `${a} -> ${b}`);
      assert.ok(res.totals.transfer > 0, `${a} -> ${b}`);
      assert.ok(hasRoad(pricing.transferRates, a, b));
    }
  }
});

test("the Excel for management: filled rows come back as new rates, empty ones are skipped", async () => {
  const { buildMissingTransfersWorkbook, readMissingTransfersWorkbook } = await import("./missing-transfers-workbook");
  const ExcelJS = (await import("exceljs")).default;
  const pairs = missingTransferPairs(input()).slice(0, 3);
  const buf = await buildMissingTransfersWorkbook(pairs, "Innova");
  // management fills in the first two rows (one with a bad drive time)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Missing transfers")!;
  ws.getRow(2).getCell(10).value = "12,500";
  ws.getRow(2).getCell(11).value = 4.5;
  ws.getRow(3).getCell(10).value = 9000;
  ws.getRow(3).getCell(11).value = "a while";
  const read = await readMissingTransfersWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.ok(read);
  assert.deepEqual(read.rows.map((r) => [r.from_location_id, r.to_location_id, r.vehicle_type, r.capacity, r.rate, r.drive_hours]), [[pairs[0].from_id, pairs[0].to_id, "Innova", 4, 12500, 4.5]]);
  assert.equal(read.problems.length, 1);
  assert.match(read.problems[0], /drive time/);
  // another workbook is not this sheet
  const other = new ExcelJS.Workbook();
  other.addWorksheet("Room tariff");
  assert.equal(await readMissingTransfersWorkbook(Buffer.from(await other.xlsx.writeBuffer())), null);
});
