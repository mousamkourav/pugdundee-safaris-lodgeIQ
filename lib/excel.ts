// One-sheet Excel file from rows of values (Lodge Reporting downloads).
// Uses exceljs, like the Sales rates export.
import ExcelJS from "exceljs";

export async function sheetFromRows(sheetName: string, rows: (string | number)[][], widths: number[]): Promise<Uint8Array<ArrayBuffer>> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRows(rows);
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  const buf = new Uint8Array(await wb.xlsx.writeBuffer());
  const out = new Uint8Array(buf.byteLength); // a plain ArrayBuffer, as a Response body needs
  out.set(buf);
  return out;
}
