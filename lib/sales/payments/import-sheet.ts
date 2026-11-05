// The one-time import of the payments Excel (the sheet the team kept before LodgeIQ). Pure: the
// rows come in as cell values (text, numbers, dates), the result is what will be saved and every
// row that needs a look, in plain words. Nothing is guessed: a cell that cannot be read is reported.
//
// Columns (found by their headings, any order): Check In, Check Out, Booking No., Guest Name, Rooms,
// Nights, R. Tariff, S. Tariff, T. Tariff, Total, Payment 1, Date, Payment 2, Date, Payment 3, Date
// (more payment pairs are fine), Balance. A payment "date" cell that says PAL / website / UPI... is
// the payment mode; its date is then not known.

import type { PaymentMode } from "./money";

export type Cell = string | number | Date | boolean | null | undefined;

// The lodge from the Djubo booking number's letters (DBE0004616 = Denwa Backwater Escape)
export const DJUBO_LODGE: Record<string, string> = {
  DBE: "Denwa Backwater Escape",
  WEL: "Waghoba Eco Lodge",
  KIN: "Kings Lodge",
  PTL: "Pench Tree Lodge",
  KEL: "Kanha Earth Lodge",
  THH: "Tree House Hideaway",
  KRL: "Ken River Lodge",
};

export type ColKey = "check_in" | "check_out" | "booking_no" | "guest" | "rooms" | "nights" | "room" | "safari" | "transfer" | "total" | "balance";
export interface Mapping {
  header_row: number; // 0-based
  cols: Partial<Record<ColKey, number>>;
  payments: { amount: number; date: number | null }[];
}

export interface ImportPayment {
  amount: number;
  paid_on: string | null;
  mode: PaymentMode;
  note: string | null;
}
export interface ImportLine {
  row: number; // the Excel row number (1-based)
  booking_no: string | null;
  lodge_name: string;
  check_in: string;
  check_out: string;
  rooms: number;
  nights: number;
  room_amount: number;
  safari_amount: number;
  transfer_amount: number;
  other_amount: number; // a Total above R + S + T (or the Total when they are empty)
  payments: ImportPayment[];
}
export interface ImportBooking {
  guest_name: string;
  lines: ImportLine[];
}
export interface RowNote {
  row: number;
  level: "error" | "warning";
  text: string;
}
export interface ImportPreview {
  mapping: Mapping;
  bookings: ImportBooking[];
  notes: RowNote[]; // errors: the row is left out; warnings: saved, worth a look
  rowsRead: number;
}

const norm = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HEAD: [ColKey, RegExp][] = [
  ["check_in", /^check ?in$/],
  ["check_out", /^check ?out$/],
  ["booking_no", /^(booking|r|res|reservation|djubo)( no| number| id)?$/],
  ["guest", /^(guest|guest name|name)$/],
  ["rooms", /^rooms?$/],
  ["nights", /^nights?$/],
  ["room", /^r tariff$|^room tariff$|^rooms? amount$/],
  ["safari", /^s tariff$|^safari tariff$|^safaris? amount$/],
  ["transfer", /^t tariff$|^transfer tariff$|^transfers? amount$/],
  ["total", /^total$/],
  ["balance", /^balance$/],
];

// The heading row and the columns (the first row that has Check In and Guest Name).
export function findMapping(rows: Cell[][]): Mapping | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const heads = rows[r].map(norm);
    if (!heads.some((h) => /^check ?in$/.test(h)) || !heads.some((h) => /guest|name/.test(h))) continue;
    const cols: Mapping["cols"] = {};
    heads.forEach((h, c) => {
      for (const [k, re] of HEAD) if (re.test(h) && cols[k] === undefined) cols[k] = c;
    });
    const payments: Mapping["payments"] = [];
    heads.forEach((h, c) => {
      if (/^payment ?\d*$/.test(h)) payments.push({ amount: c, date: heads[c + 1] === "date" ? c + 1 : null });
    });
    return { header_row: r, cols, payments };
  }
  return null;
}

// a date from a cell: an Excel date, an Excel day number, or dd-mm-yy / dd-mm-yyyy / dd/mm/yyyy
export function readDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel dates are read as UTC midnight
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.getUTCDate() === d && t.getUTCMonth() + 1 === mo ? iso : null;
}

const readNum = (v: Cell): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Number(String(v).replace(/[,\s]/g, "").replace(/^(rs\.?|inr)/i, ""));
  return Number.isFinite(t) ? t : null;
};

// the payment mode written in a date cell ("PAL", "website")
export function readMode(v: Cell): PaymentMode | null {
  const t = norm(v);
  if (!t) return null;
  if (/^(pal|payment link|link|razorpay|paypal)$/.test(t)) return "payment_link";
  if (/^(website|web|online)$/.test(t)) return "website";
  if (/^upi|gpay|phonepe|paytm/.test(t)) return "upi";
  if (/^(card|credit card|debit card)$/.test(t)) return "card";
  if (/^cash$/.test(t)) return "cash";
  if (/^(neft|rtgs|imps|bank|bank transfer|transfer)$/.test(t)) return "bank_transfer";
  if (/^agent$/.test(t)) return "agent";
  return null;
}

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function readPaymentsSheet(rows: Cell[][], mapping?: Mapping | null): ImportPreview | { error: string } {
  const map = mapping ?? findMapping(rows);
  if (!map) return { error: "No heading row with Check In and Guest Name was found in the first 20 rows." };
  const need: ColKey[] = ["check_in", "check_out", "guest", "total"];
  const missing = need.filter((k) => map.cols[k] === undefined);
  if (missing.length) return { error: `These columns were not found: ${missing.join(", ")}.` };
  const c = map.cols;
  const notes: RowNote[] = [];
  const lines: (ImportLine & { guest: string })[] = [];
  let rowsRead = 0;

  for (let r = map.header_row + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const at = (k: ColKey) => (c[k] === undefined ? null : row[c[k]!]);
    const guest = String(at("guest") ?? "").trim();
    const anything = row.some((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (!anything) continue;
    rowsRead++;
    const n = r + 1;
    const errs: string[] = [];
    const warn = (t: string) => notes.push({ row: n, level: "warning", text: t });
    if (!guest) errs.push("no guest name");
    const ci = readDate(at("check_in"));
    const co = readDate(at("check_out"));
    if (!ci) errs.push(`check-in "${String(at("check_in") ?? "")}" is not a date`);
    if (!co) errs.push(`check-out "${String(at("check_out") ?? "")}" is not a date`);
    if (ci && co && co < ci) errs.push("check-out is before check-in");
    const total = readNum(at("total"));
    if (total === null || total < 0) errs.push(`total "${String(at("total") ?? "")}" is not an amount`);
    const amt = (k: ColKey) => {
      const v = readNum(at(k));
      if (v !== null && v < 0) errs.push(`${k} amount is below 0`);
      return v ?? 0;
    };
    const room = amt("room");
    const safari = amt("safari");
    const transfer = amt("transfer");
    const payments: ImportPayment[] = [];
    map.payments.forEach((pc, k) => {
      const a = readNum(row[pc.amount]);
      const raw = pc.date === null ? null : row[pc.date];
      if (a === null || a === 0) {
        if (raw !== null && raw !== undefined && String(raw).trim()) warn(`payment ${k + 1}: a date or mode but no amount`);
        return;
      }
      if (a < 0) {
        errs.push(`payment ${k + 1} is below 0`);
        return;
      }
      const date = readDate(raw);
      const mode = date ? null : readMode(raw);
      if (!date && !mode && raw !== null && raw !== undefined && String(raw).trim()) warn(`payment ${k + 1}: "${String(raw)}" is neither a date nor a payment mode`);
      if (!date) warn(`payment ${k + 1}: no date${mode ? ` (mode ${String(raw).trim()})` : ""}`);
      payments.push({ amount: r2(a), paid_on: date, mode: mode ?? "other", note: !date && mode ? String(raw).trim() : null });
    });
    if (errs.length) {
      notes.push({ row: n, level: "error", text: `Left out: ${errs.join("; ")}.` });
      continue;
    }
    const bookingNo = String(at("booking_no") ?? "").trim().toUpperCase() || null;
    const prefix = bookingNo?.slice(0, 3) ?? "";
    const lodge = DJUBO_LODGE[prefix] ?? "";
    if (!bookingNo) warn("no booking number");
    else if (!lodge) warn(`the lodge is not known from the booking number "${bookingNo}" (set it on the booking)`);
    const rooms = readNum(at("rooms"));
    const nights = readNum(at("nights"));
    // the sheet's own sums, checked (saved as written)
    const parts = r2(room + safari + transfer);
    if (parts > 0 && Math.abs(parts - total!) > 1) warn(`R + S + T tariff (${parts}) is not the Total (${total})`);
    const paid = r2(payments.reduce((t, p) => t + p.amount, 0));
    const bal = readNum(at("balance"));
    const expected = r2(total! - paid);
    if (Math.abs((bal ?? 0) - expected) > 1) warn(`Balance ${bal ?? "(empty)"} is not Total - payments (${expected})`);
    const stay = nightsBetween(ci!, co!);
    if (nights !== null && rooms !== null && nights !== stay && nights !== stay * rooms) warn(`Nights ${nights} is neither the ${stay} nights between the dates nor rooms x nights (${stay * rooms})`);
    lines.push({
      row: n,
      guest,
      booking_no: bookingNo,
      lodge_name: lodge,
      check_in: ci!,
      check_out: co!,
      rooms: rooms !== null && rooms >= 0 ? Math.round(rooms) : 1,
      nights: nights !== null && nights >= 0 ? Math.round(nights) : stay,
      // the sheet's Total is what the guest owes: R / S / T as written, the rest as "other"
      room_amount: r2(room),
      safari_amount: r2(safari),
      transfer_amount: r2(transfer),
      other_amount: total! > parts + 1 ? r2(total! - parts) : 0,
      payments,
    });
  }

  // a year far from the others (17-10-19 among 2026 dates): a typing slip, to be checked
  const years = lines.map((l) => Number(l.check_in.slice(0, 4))).sort((a, b) => a - b);
  const mid = years[Math.floor(years.length / 2)];
  for (const l of lines) {
    const y = Number(l.check_in.slice(0, 4));
    if (Math.abs(y - mid) >= 1) notes.push({ row: l.row, level: "warning", text: `Check-in year ${y}: most rows are ${mid}. Check the date.` });
  }

  // one booking per guest: the same name with check-ins within 45 days (one trip over several lodges)
  const bookings: ImportBooking[] = [];
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const l of [...lines].sort((a, b) => a.check_in.localeCompare(b.check_in) || a.row - b.row)) {
    const { guest, ...line } = l;
    const same = bookings.find((b) => key(b.guest_name) === key(guest) && b.lines.some((x) => Math.abs(nightsBetween(x.check_in, line.check_in)) <= 45));
    if (same) same.lines.push(line);
    else bookings.push({ guest_name: guest, lines: [line] });
  }
  notes.sort((a, b) => a.row - b.row);
  return { mapping: map, bookings, notes, rowsRead };
}
