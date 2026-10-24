// Run with:  npx tsx --test lib/sales/master/rates-workbook.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { getEntity } from "./entities";
import { fromCell, sameValue, sheetColumns, toCell } from "./rates-sheet";
import { buildRatesWorkbook, readRatesWorkbook, type SheetData } from "./rates-workbook";
import type { FieldDef } from "./types";

const tariff = getEntity("tariff")!;
// the reference filled in, as withOptions() does on the server
const fields: FieldDef[] = tariff.fields.map((f) => (f.name === "rate_category_id" ? { ...f, options: [{ value: "cat-cottage", label: "Cottage" }] } : f));
const ID = "0b5a8a4e-6f9d-4c55-9a43-7f4d2c1e9b10";
const row = {
  id: ID,
  rate_category_id: "cat-cottage",
  nationality: "foreign",
  season: "high",
  valid_from: "2026-10-01",
  valid_to: "2027-06-30",
  rate_double: 22000,
  rate_single: 18500,
  weekend_rate_double: null,
  weekend_rate_single: null,
  meal_plan: "AP",
  extra_adult_pct: 40,
  child_free_under: 5,
  child_5_12_pct: 25,
  child_13_17_pct: 40,
  min_nights: 2,
  tax_pct: 18,
  rates_include_tax: false,
  notes: null,
  active: true,
};
const sheets: SheetData[] = [{ sheet: "Room tariff", entity: "tariff", fields, rows: [row] }];
const build = () =>
  buildRatesWorkbook({
    sheets,
    payment: [
      { label: "Deposit", pct: 50, days_before_arrival: null },
      { label: "Balance", pct: 50, days_before_arrival: 45 },
    ],
    cancellation: [{ min_days: 0, max_days: 7, pct: 100 }],
    exportedAt: "24 Oct 2026",
    exportedBy: "Test",
  });

test("columns: hidden ID, the category to identify the row, rates editable, incl. GST next to rates", () => {
  const cols = sheetColumns("tariff", fields);
  assert.equal(cols[0].kind, "id");
  assert.equal(cols[1].field, "rate_category_id");
  assert.equal(cols[1].kind, "grey");
  const dbl = cols.findIndex((c) => c.field === "rate_double");
  assert.equal(cols[dbl].kind, "edit");
  assert.deepEqual([cols[dbl + 1].kind, cols[dbl + 1].of], ["gst", "rate_double"]);
});

test("the workbook has the sheets, styles and an incl. GST formula", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await build()) as unknown as ArrayBuffer);
  assert.deepEqual(
    wb.worksheets.filter((w) => w.state === "visible").map((w) => w.name),
    ["Read me", "Room tariff", "Payment & cancellation"]
  );
  const ws = wb.getWorksheet("Room tariff")!;
  assert.equal(ws.getColumn(1).hidden, true);
  assert.equal(ws.getRow(2).getCell(1).value, ID);
  assert.equal(ws.getRow(2).getCell(2).value, "Cottage");
  const cols = sheetColumns("tariff", fields);
  const gst = cols.findIndex((c) => c.kind === "gst" && c.of === "rate_double") + 1;
  const f = (ws.getRow(2).getCell(gst).value as { formula: string }).formula;
  assert.match(f, /ROUND\(.+\*IF\(.+="Yes",1,1\+N\(.+\)\/100\),0\)/);
  assert.equal(ws.getRow(2).getCell(2).font?.name, "Arial");
});

test("read back: an edited rate, date and dropdown come back as database values", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await build()) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Room tariff")!;
  const cols = sheetColumns("tariff", fields);
  const at = (field: string) => ws.getRow(2).getCell(cols.findIndex((c) => c.field === field) + 1);
  at("rate_double").value = 23500;
  at("valid_to").value = "30-09-2027"; // typed as text
  at("season").value = "Peak (incl. long weekends)";
  at("rates_include_tax").value = "yes";
  // a new row without an ID
  ws.getRow(3).getCell(cols.findIndex((c) => c.field === "rate_double") + 1).value = 99;
  const read = await readRatesWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(read.problem, undefined);
  const rs = read.sheets.find((s) => s.sheet === "Room tariff")!;
  assert.equal(rs.newRows, 1);
  assert.equal(rs.rows.length, 1);
  const by = (n: string) => fromCell(fields.find((f) => f.name === n)!, rs.rows[0].cells[n]);
  assert.deepEqual(by("rate_double"), { value: 23500 });
  assert.deepEqual(by("valid_to"), { value: "2027-09-30" });
  assert.deepEqual(by("valid_from"), { value: "2026-10-01" }); // a real Excel date, unchanged
  assert.deepEqual(by("season"), { value: "peak" });
  assert.deepEqual(by("rates_include_tax"), { value: true });
  assert.ok(sameValue(fields.find((f) => f.name === "nationality")!, "foreign", by("nationality").value));
  assert.equal(read.payment?.filter((p) => p.label).length, 2);
  assert.deepEqual(read.cancellation?.[0], { from: 0, to: 7, pct: 100 });
});

test("cell values: bad input is reported, not guessed", () => {
  const f = (n: string) => fields.find((x) => x.name === n)!;
  assert.ok(fromCell(f("rate_double"), "abc").error);
  assert.ok(fromCell(f("rate_double"), "").error); // required
  assert.deepEqual(fromCell(f("rate_double"), "Rs 22,000"), { value: 22000 });
  assert.ok(fromCell(f("season"), "Monsoon").error);
  assert.deepEqual(fromCell(f("valid_from"), "5 Jan 2027"), { value: "2027-01-05" });
  assert.deepEqual(fromCell({ name: "w", label: "Weekend days", type: "weekdays" }, "Sat, Sun"), { value: [0, 6] });
  assert.equal(toCell({ name: "w", label: "Weekend days", type: "weekdays" }, [0, 6]), "Sun, Sat");
  assert.deepEqual(fromCell(f("min_nights"), ""), { value: 2 }); // the form's default
});
