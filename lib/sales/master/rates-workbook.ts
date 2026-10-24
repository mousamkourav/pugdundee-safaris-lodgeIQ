// Builds and reads the "all rates" Excel workbook (exceljs). No database here:
// the export route passes the rows in, the import passes the uploaded file.
import ExcelJS from "exceljs";
import { PAYMENT_SHEET, RATE_SHEETS, sheetColumns, toCell, type CancellationRow, type CellIn, type PaymentRow, type SheetColumn } from "./rates-sheet";
import type { FieldDef } from "./types";

const FONT = "Arial";
const GREY = "FFE7E5E4";
const YELLOW = "FFFFF2CC";
const HEAD = "FF4A4A2A";
const META = "_columns";

export interface SheetData {
  sheet: string;
  entity: string;
  fields: FieldDef[]; // with ref / select options filled in
  rows: Record<string, unknown>[];
}

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD6D3D1" } },
  bottom: { style: "thin", color: { argb: "FFD6D3D1" } },
  left: { style: "thin", color: { argb: "FFD6D3D1" } },
  right: { style: "thin", color: { argb: "FFD6D3D1" } },
};

function styleHeader(row: ExcelJS.Row) {
  row.height = 32;
  row.eachCell((c) => {
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill(HEAD);
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = thin;
  });
}

function numFmt(f: FieldDef | undefined): string | undefined {
  if (!f) return undefined;
  if (f.type === "money") return "#,##0";
  if (f.type === "date") return "dd-mmm-yyyy";
  if (f.type === "number") return "0.##";
  return undefined;
}

// A dropdown list must stay under Excel's 255 characters.
const listOf = (labels: string[]) => {
  const s = labels.map((l) => l.replace(/[",]/g, " ")).join(",");
  return s.length <= 250 ? [`"${s}"`] : null;
};

export async function buildRatesWorkbook(input: {
  sheets: SheetData[];
  payment: PaymentRow[];
  cancellation: CancellationRow[];
  exportedAt: string; // e.g. "24 Oct 2026, 11:20"
  exportedBy: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LodgeIQ";
  wb.created = new Date();

  // ---------------- Read me ----------------
  const me = wb.addWorksheet("Read me", { properties: { tabColor: { argb: "FF907A17" } } });
  me.getColumn(1).width = 4;
  me.getColumn(2).width = 30;
  me.getColumn(3).width = 90;
  const line = (b: string, c = "", opts: { bold?: boolean; size?: number; fillArgb?: string } = {}) => {
    const r = me.addRow(["", b, c]);
    r.getCell(2).font = { name: FONT, size: opts.size ?? 10, bold: opts.bold ?? false };
    r.getCell(3).font = { name: FONT, size: 10 };
    r.getCell(3).alignment = { wrapText: true, vertical: "top" };
    r.getCell(2).alignment = { vertical: "top" };
    if (opts.fillArgb) {
      r.getCell(2).fill = fill(opts.fillArgb);
      r.getCell(2).border = thin;
    }
    return r;
  };
  me.addRow([]);
  line("Pugdundee Safaris - all rates", "", { bold: true, size: 14 });
  line("Exported", `${input.exportedAt} by ${input.exportedBy}, from the live LodgeIQ database.`);
  me.addRow([]);
  line("How to read it", "", { bold: true, size: 11 });
  line("Yellow cell", "Can be changed. Type the new value over the old one.", { fillArgb: YELLOW });
  line("Grey cell", "Identifies the row (lodge, park, category...) or is worked out by a formula. Do not change it.", { fillArgb: GREY });
  line("incl. GST columns", "Worked out from the rate and the GST %, for checking. They are not imported.");
  line("Dates", "dd-mm-yyyy, or pick from the cell. Yes / No cells: type Yes or No.");
  line("Do not", "insert, delete or move columns, rename the sheets, or change the hidden ID column. New rows cannot be imported: add new items in LodgeIQ > Master data.");
  me.addRow([]);
  line("Sending it back", "", { bold: true, size: 11 });
  line("1.", "Make the changes in the yellow cells and save the file (keep it as .xlsx).");
  line("2.", "In LodgeIQ: Sales > Master data > Import rates from Excel, and choose the file.");
  line("3.", "LodgeIQ shows every change (old value -> new value). Nothing changes until you press Apply.");
  line("4.", "Changes apply to new quotes only. Saved quotes keep their prices.");
  me.addRow([]);
  line("Sheets", "", { bold: true, size: 11 });
  for (const s of RATE_SHEETS) line(s.sheet, s.intro);
  line(PAYMENT_SHEET, "The payment schedule and cancellation charges printed on every quote.");

  // hidden map of columns, so the import does not depend on header wording
  const meta = wb.addWorksheet(META, { state: "veryHidden" });
  meta.addRow(["sheet", "entity", "column", "kind", "field"]);

  // ---------------- one sheet per table ----------------
  for (const sd of input.sheets) {
    const ws = wb.addWorksheet(sd.sheet, { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
    const byName = new Map(sd.fields.map((f) => [f.name, f]));
    const cols: SheetColumn[] = sheetColumns(sd.entity, sd.fields);
    ws.columns = cols.map((c) => ({ header: c.header, width: c.width, hidden: c.kind === "id" }));
    styleHeader(ws.getRow(1));
    cols.forEach((c, i) => meta.addRow([sd.sheet, sd.entity, i + 1, c.kind, c.field ?? c.of ?? ""]));

    const colOf = (field: string) => cols.findIndex((c) => c.field === field) + 1;
    const letter = (i: number) => ws.getColumn(i).letter;
    const taxCol = colOf("tax_pct");
    const inclCol = colOf("rates_include_tax");

    sd.rows.forEach((row, k) => {
      const r = ws.getRow(k + 2);
      cols.forEach((c, i) => {
        const cell = r.getCell(i + 1);
        const f = c.field ? byName.get(c.field) : undefined;
        if (c.kind === "id") cell.value = String(row.id ?? "");
        else if (c.kind === "gst") {
          const rate = `${letter(colOf(c.of!))}${k + 2}`;
          const tax = taxCol ? `${letter(taxCol)}${k + 2}` : "0";
          const incl = inclCol ? `${letter(inclCol)}${k + 2}="Yes"` : "FALSE";
          cell.value = { formula: `IF(${rate}="","",ROUND(${rate}*IF(${incl},1,1+N(${tax})/100),0))` };
          cell.numFmt = "#,##0";
        } else if (f) {
          cell.value = toCell(f, row[f.name]) as ExcelJS.CellValue;
          const fmt = numFmt(f);
          if (fmt) cell.numFmt = fmt;
        }
        cell.font = { name: FONT, size: 10 };
        cell.fill = fill(c.kind === "edit" ? YELLOW : GREY);
        cell.border = thin;
        cell.alignment = { vertical: "top", wrapText: f?.type === "textarea" };
        if (c.kind === "edit" && f) {
          if (f.type === "bool") cell.dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No"'] };
          else if (f.type === "select" && f.options?.length) {
            const formulae = listOf(f.options.map((o) => o.label));
            if (formulae) cell.dataValidation = { type: "list", allowBlank: !f.required, formulae, showErrorMessage: true, errorTitle: f.label, error: "Choose from the list." };
          } else if (f.type === "money") cell.dataValidation = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: !f.required, formulae: [0], showErrorMessage: true, error: "A rate in rupees, 0 or more." };
          else if (f.type === "date") cell.dataValidation = { type: "date", operator: "greaterThan", allowBlank: !f.required, formulae: [new Date(Date.UTC(2020, 0, 1))], showErrorMessage: true, error: "A date, dd-mm-yyyy." };
        }
      });
    });
    if (sd.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    if (!sd.rows.length) {
      const r = ws.getRow(2);
      r.getCell(2).value = "Nothing here yet.";
      r.getCell(2).font = { name: FONT, size: 10, italic: true, color: { argb: "FF78716C" } };
    }
  }

  // ---------------- payment & cancellation ----------------
  const pc = wb.addWorksheet(PAYMENT_SHEET);
  pc.columns = [{ width: 30 }, { width: 16 }, { width: 30 }];
  const title = (t: string, help: string) => {
    const r = pc.addRow([t]);
    r.getCell(1).font = { name: FONT, size: 12, bold: true };
    const h = pc.addRow([help]);
    h.getCell(1).font = { name: FONT, size: 9, italic: true, color: { argb: "FF78716C" } };
  };
  const edit = (r: ExcelJS.Row, n: number) => {
    for (let i = 1; i <= n; i++) {
      const c = r.getCell(i);
      c.font = { name: FONT, size: 10 };
      c.fill = fill(YELLOW);
      c.border = thin;
    }
  };
  title("Payment schedule", "Percentages must add up to 100. Empty days = at booking. Clear a whole row to remove it; use the empty rows to add one.");
  styleHeader(pc.addRow(["Instalment", "% of total", "Days before arrival"]));
  for (const p of [...input.payment, ...Array.from({ length: 3 }, () => null)]) edit(pc.addRow(p ? [p.label, p.pct, p.days_before_arrival] : ["", null, null]), 3);
  pc.addRow([]);
  title("Cancellation charges", "Charge as % of the total, by days before arrival. Empty 'to' = no upper limit.");
  styleHeader(pc.addRow(["From (days before arrival)", "To (days)", "% charged"]));
  for (const c of [...input.cancellation, ...Array.from({ length: 3 }, () => null)]) edit(pc.addRow(c ? [c.min_days, c.max_days, c.pct] : [null, null, null]), 3);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- reading it back

export interface ReadSheet {
  sheet: string;
  entity: string;
  rows: { line: number; id: string; cells: Record<string, CellIn> }[];
  newRows: number; // rows without an ID (not imported)
}

export async function readRatesWorkbook(buf: ArrayBuffer | Buffer): Promise<{
  sheets: ReadSheet[];
  payment: { label: CellIn; pct: CellIn; days: CellIn }[] | null;
  cancellation: { from: CellIn; to: CellIn; pct: CellIn }[] | null;
  problem?: string;
}> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    return { sheets: [], payment: null, cancellation: null, problem: "The file could not be opened. Save it as an Excel workbook (.xlsx) and try again." };
  }
  const meta = wb.getWorksheet(META);
  if (!meta) return { sheets: [], payment: null, cancellation: null, problem: "This is not a LodgeIQ rates export (the column map is missing). Start from Export all rates." };

  const map = new Map<string, { entity: string; cols: { col: number; kind: string; field: string }[] }>();
  meta.eachRow((r, n) => {
    if (n === 1) return;
    const sheet = String(r.getCell(1).value ?? "");
    const m = map.get(sheet) ?? { entity: String(r.getCell(2).value ?? ""), cols: [] };
    m.cols.push({ col: Number(r.getCell(3).value), kind: String(r.getCell(4).value ?? ""), field: String(r.getCell(5).value ?? "") });
    map.set(sheet, m);
  });

  const sheets: ReadSheet[] = [];
  for (const [sheet, m] of map) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) continue;
    const idCol = m.cols.find((c) => c.kind === "id")?.col ?? 1;
    const out: ReadSheet = { sheet, entity: m.entity, rows: [], newRows: 0 };
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const id = String(r.getCell(idCol).value ?? "").trim();
      const cells: Record<string, CellIn> = {};
      let any = false;
      for (const c of m.cols) {
        if (c.kind !== "edit") continue;
        const v = r.getCell(c.col).value as CellIn;
        cells[c.field] = v;
        if (v !== null && v !== undefined && v !== "") any = true;
      }
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        if (any) out.newRows++;
        return;
      }
      out.rows.push({ line: n, id, cells });
    });
    sheets.push(out);
  }

  // payment & cancellation: the rows under each table's header
  const pc = wb.getWorksheet(PAYMENT_SHEET);
  let payment: { label: CellIn; pct: CellIn; days: CellIn }[] | null = null;
  let cancellation: { from: CellIn; to: CellIn; pct: CellIn }[] | null = null;
  if (pc) {
    let section: "pay" | "cancel" | null = null;
    pc.eachRow({ includeEmpty: false }, (r) => {
      const a = String(r.getCell(1).value ?? "").trim();
      if (a === "Payment schedule") return void (section = null);
      if (a === "Cancellation charges") return void (section = null);
      if (a === "Instalment") {
        payment = [];
        return void (section = "pay");
      }
      if (a.startsWith("From (days")) {
        cancellation = [];
        return void (section = "cancel");
      }
      if (section === "pay") payment!.push({ label: r.getCell(1).value as CellIn, pct: r.getCell(2).value as CellIn, days: r.getCell(3).value as CellIn });
      if (section === "cancel") cancellation!.push({ from: r.getCell(1).value as CellIn, to: r.getCell(2).value as CellIn, pct: r.getCell(3).value as CellIn });
    });
  }
  return { sheets, payment, cancellation };
}
