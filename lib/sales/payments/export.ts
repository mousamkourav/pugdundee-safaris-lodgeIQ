// The payments list as Excel, with the columns of the team's sheet: one row per lodge booking.
// Payments made for the whole booking (not one lodge) are on its first row.
import ExcelJS from "exceljs";
import { byLine, money, nextDue, status, STATUS_TEXT, MODE_LABEL, KIND_LABEL, type Booking, type BookingPayment } from "./money";

export interface ExportRow {
  check_in: string | null;
  check_out: string | null;
  booking_no: string;
  guest: string;
  lodge: string;
  rooms: number;
  nights: number;
  room: number;
  safari: number;
  transfer: number;
  other: number;
  total: number;
  payments: { amount: number; date: string | null; how: string }[];
  balance: number;
  next_due: string | null;
  status: string;
  salesperson: string;
  query_no: string;
}

const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "");

export function exportRows(bookings: Booking[], today: string, names: Record<string, string>): ExportRow[] {
  const out: ExportRow[] = [];
  for (const b of bookings) {
    const st = STATUS_TEXT[status(b, today)];
    const nd = nextDue(b);
    const lines = [...b.lines].sort((x, y) => x.sort - y.sort);
    const share = byLine(b);
    const pays = b.payments.filter((p) => !p.deleted_at);
    const item = (p: BookingPayment) => ({ amount: p.kind === "payment" ? p.amount : -p.amount, date: p.paid_on, how: p.kind === "payment" ? MODE_LABEL[p.mode] : KIND_LABEL[p.kind] });
    const base = { guest: b.guest_name, status: st, salesperson: b.owner_id ? names[b.owner_id] ?? "" : "", query_no: b.query_no ?? "" };
    if (!lines.length) {
      const m = money(b);
      out.push({ ...base, check_in: b.check_in, check_out: b.check_out, booking_no: "", lodge: "", rooms: 0, nights: 0, room: 0, safari: 0, transfer: 0, other: m.total, total: m.total, payments: pays.map(item), balance: m.balance, next_due: nd?.due_on ?? null });
      continue;
    }
    lines.forEach((l, i) => {
      const own = pays.filter((p) => p.line_id === l.id || (i === 0 && (!p.line_id || !lines.some((x) => x.id === p.line_id))));
      const extra = i === 0 ? b.other_amount - b.discount_amount : 0;
      const sh = share.get(l.id)!;
      out.push({
        ...base,
        check_in: l.check_in,
        check_out: l.check_out,
        booking_no: l.booking_no ?? "",
        lodge: l.lodge_name,
        rooms: l.rooms,
        nights: l.nights,
        room: l.room_amount,
        safari: l.safari_amount,
        transfer: l.transfer_amount,
        other: l.other_amount + extra,
        total: sh.total + extra,
        payments: own.map(item),
        balance: i === 0 ? Math.round((money(b).balance - [...share.values()].slice(1).reduce((t, x) => t + x.balance, 0)) * 100) / 100 : sh.balance,
        next_due: nd?.due_on ?? null,
      });
    });
  }
  return out;
}

export async function buildPaymentsWorkbook(rows: ExportRow[], meta: { exportedAt: string; exportedBy: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LodgeIQ";
  const ws = wb.addWorksheet("Payments", { views: [{ state: "frozen", ySplit: 1 }] });
  const most = Math.max(3, ...rows.map((r) => r.payments.length));
  const head = ["Check In", "Check Out", "Booking No.", "Guest Name", "Lodge", "Rooms", "Nights", "R. Tariff", "S. Tariff", "T. Tariff", "Other", "Total"];
  for (let k = 1; k <= most; k++) head.push(`Payment ${k}`, "Date");
  head.push("Balance", "Next due", "Status", "Salesperson", "Query");
  ws.addRow(head);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const cells: (string | number | null)[] = [dmy(r.check_in), dmy(r.check_out), r.booking_no, r.guest, r.lodge, r.rooms, r.nights, r.room || null, r.safari || null, r.transfer || null, r.other || null, r.total];
    for (let k = 0; k < most; k++) {
      const p = r.payments[k];
      cells.push(p ? p.amount : null, p ? dmy(p.date) || p.how : null);
    }
    cells.push(r.balance || null, dmy(r.next_due), r.status, r.salesperson, r.query_no);
    ws.addRow(cells);
  }
  ws.columns.forEach((c, i) => {
    c.width = i === 3 || i === 4 ? 26 : 12;
  });
  for (let i = 8; i <= head.length; i++) ws.getColumn(i).numFmt = "#,##,##0";
  ws.addRow([]);
  ws.addRow([`Exported ${meta.exportedAt} by ${meta.exportedBy}, from LodgeIQ.`]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
