// Reads the team's payments Excel and returns what would be imported, and every row that needs a
// look. Nothing is saved here: the import page saves after the preview. Sales admins only.
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { readPaymentsSheet, type Cell } from "@/lib/sales/payments/import-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

// a cell as text / number / date (formulas: their last value)
function value(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object" && "result" in v) return value((v as { result: ExcelJS.CellValue }).result);
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if (typeof v === "object" && "text" in v) return String((v as { text: string }).text);
  return null;
}

export async function POST(req: Request) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return NextResponse.json({ error: "Only Sales admins can import." }, { status: 403 });
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose the Excel file first." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is too large (over 4 MB)." }, { status: 400 });
    if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Choose an Excel .xlsx file (in Excel: Save as, Excel workbook)." }, { status: 400 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const want = String(fd.get("sheet") ?? "");
    const sheets = wb.worksheets.map((w) => w.name);
    const ws = (want && wb.getWorksheet(want)) || wb.worksheets[0];
    if (!ws) return NextResponse.json({ error: "The file has no sheets." }, { status: 400 });
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: Cell[] = [];
      for (let c = 1; c <= Math.min(row.cellCount, 60); c++) cells.push(value(row.getCell(c).value));
      rows[n - 1] = cells;
    });
    const preview = readPaymentsSheet(Array.from(rows, (r) => r ?? []).slice(0, 10_000));
    if ("error" in preview) return NextResponse.json({ error: preview.error, sheets, sheet: ws.name }, { status: 400 });
    return NextResponse.json({ ...preview, sheets, sheet: ws.name });
  } catch (e) {
    console.error("[sales] payments import preview failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The file could not be read. Save it as an Excel workbook (.xlsx) and try again." }, { status: 500 });
  }
}
