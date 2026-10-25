// Run with:  npx tsx --test lib/excel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { sheetFromRows } from "./excel";

test("Lodge Reporting downloads: rows, blank lines, numbers and column widths survive", async () => {
  const bytes = await sheetFromRows("Monthly Report", [["Pugdundee Safaris - Monthly Report"], ["Lodge", "Kings Lodge"], [], ["Rooms paid", 42]], [28, 18]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Monthly Report")!;
  assert.equal(ws.getCell("A1").value, "Pugdundee Safaris - Monthly Report");
  assert.equal(ws.getCell("B2").value, "Kings Lodge");
  assert.equal(ws.getCell("A3").value, null); // the blank line is kept
  assert.equal(ws.getCell("B4").value, 42); // a number, not text
  assert.equal(ws.getColumn(1).width, 28);
});
