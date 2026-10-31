// The "Missing transfer rates" Excel: one row per road with no rate, for management to
// fill in (vehicle, rate, drive time). The filled file goes back through Master data >
// Import rates from Excel, which adds the rates (preview first). No database here.
import ExcelJS from "exceljs";
import { PAIR_KIND_LABEL, type MissingPair } from "./missing-transfers";

export const MISSING_SHEET = "Missing transfers";
const FONT = "Arial";
const HEAD = "FF4A4A2A";
const YELLOW = "FFFFF2CC";
const GREY = "FFE7E5E4";

// Columns, in order. The first two (place ids) are hidden: the import reads them back.
const COLS = [
  { key: "from_id", header: "From (id)", width: 10 },
  { key: "to_id", header: "To (id)", width: 10 },
  { key: "from_name", header: "From", width: 30 },
  { key: "to_name", header: "To", width: 30 },
  { key: "kind", header: "Why it is needed", width: 26 },
  { key: "needed", header: "Times needed in quotes", width: 12 },
  { key: "last_price", header: "Last price typed in a quote", width: 14 },
  { key: "vehicle", header: "Vehicle", width: 22, edit: true },
  { key: "capacity", header: "Capacity (guests)", width: 10, edit: true },
  { key: "rate", header: "Rate one way, per vehicle, incl. GST", width: 16, edit: true },
  { key: "drive_hours", header: "Drive time (hours)", width: 11, edit: true },
] as const;

export async function buildMissingTransfersWorkbook(pairs: MissingPair[], vehicle: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LodgeIQ";
  const ws = wb.addWorksheet(MISSING_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getColumn(1).hidden = true;
  ws.getColumn(2).hidden = true;
  for (const p of pairs) {
    ws.addRow({ from_id: p.from_id, to_id: p.to_id, from_name: p.from_name, to_name: p.to_name, kind: PAIR_KIND_LABEL[p.kind], needed: p.needed || null, last_price: p.last_price, vehicle, capacity: 4, rate: null, drive_hours: null });
  }
  const head = ws.getRow(1);
  head.height = 32;
  head.eachCell((c) => {
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  ws.eachRow((r, n) => {
    if (n === 1) return;
    COLS.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.font = { name: FONT, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "edit" in c && c.edit ? YELLOW : GREY } };
      if (c.key === "rate" || c.key === "last_price") cell.numFmt = "#,##0";
    });
  });
  const notes = wb.addWorksheet("Read me");
  notes.getColumn(1).width = 110;
  [
    "Missing transfer rates - LodgeIQ",
    "Each row is a road that quotes can need and that has no rate yet. Fill in the yellow columns:",
    "the vehicle, how many guests it takes, the rate one way per vehicle including GST, and the drive time.",
    "One rate covers both directions. Leave the rate empty for a road you do not want to add.",
    "Then: Master data > Import rates from Excel > choose this file. You see the new rates before they are added.",
  ].forEach((t, i) => {
    const c = notes.getCell(i + 1, 1);
    c.value = t;
    c.font = { name: FONT, size: i ? 10 : 13, bold: i === 0 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface NewTransfer {
  line: number;
  from_location_id: string;
  to_location_id: string;
  from_name: string;
  to_name: string;
  vehicle_type: string;
  capacity: number;
  rate: number;
  drive_hours: number | null;
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v && "result" in v) return cellText((v as { result: unknown }).result);
  if (typeof v === "object" && v && "richText" in v) return ((v as { richText: { text: string }[] }).richText ?? []).map((x) => x.text).join("");
  return String(v).trim();
};
const num = (v: unknown) => {
  const t = cellText(v).replace(/[,\s]/g, "").replace(/^(rs\.?|inr)/i, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

// Reads a filled sheet: the rows with a rate. null when the file is not this sheet.
export async function readMissingTransfersWorkbook(buf: ArrayBuffer | Buffer): Promise<{ rows: NewTransfer[]; problems: string[] } | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as ArrayBuffer);
  } catch {
    return null;
  }
  const ws = wb.getWorksheet(MISSING_SHEET);
  if (!ws) return null;
  const col = (key: string) => COLS.findIndex((c) => c.key === key) + 1;
  const rows: NewTransfer[] = [];
  const problems: string[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const rate = num(r.getCell(col("rate")).value);
    if (rate === null) return; // left empty: not added
    const from = cellText(r.getCell(col("from_id")).value);
    const to = cellText(r.getCell(col("to_id")).value);
    const where = `row ${n} (${cellText(r.getCell(col("from_name")).value)} to ${cellText(r.getCell(col("to_name")).value)})`;
    if (!from || !to) return void problems.push(`${MISSING_SHEET}, ${where}: the hidden place columns were removed. Download the sheet again.`);
    if (!(rate > 0 && rate < 1_000_000)) return void problems.push(`${MISSING_SHEET}, ${where}: the rate must be a number of rupees.`);
    const capacity = num(r.getCell(col("capacity")).value);
    const hours = num(r.getCell(col("drive_hours")).value);
    if (Number.isNaN(capacity) || (capacity !== null && !(capacity >= 1 && capacity <= 60))) return void problems.push(`${MISSING_SHEET}, ${where}: capacity must be the number of guests.`);
    if (Number.isNaN(hours) || (hours !== null && !(hours > 0 && hours < 48))) return void problems.push(`${MISSING_SHEET}, ${where}: drive time must be in hours.`);
    rows.push({
      line: n,
      from_location_id: from,
      to_location_id: to,
      from_name: cellText(r.getCell(col("from_name")).value),
      to_name: cellText(r.getCell(col("to_name")).value),
      vehicle_type: cellText(r.getCell(col("vehicle")).value).slice(0, 80) || "Toyota Innova Crysta",
      capacity: capacity ?? 4,
      rate: Math.round(rate),
      drive_hours: hours,
    });
  });
  return { rows, problems };
}
