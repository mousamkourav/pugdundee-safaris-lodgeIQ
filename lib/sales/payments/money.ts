// The payments tracker's money rules, in one pure file (tested in money.test.ts).
// A booking: one or more lodge lines (each a Djubo booking), extra amounts on the booking, the
// dues (when money is owed) and the payments, refunds and cancellation charges.

export type PaymentKind = "payment" | "refund" | "cancellation_charge";
export const PAYMENT_MODES = ["bank_transfer", "upi", "card", "cash", "website", "payment_link", "agent", "other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const MODE_LABEL: Record<PaymentMode, string> = {
  bank_transfer: "Bank transfer",
  upi: "UPI",
  card: "Card",
  cash: "Cash",
  website: "Website",
  payment_link: "Payment link (PAL)",
  agent: "Agent",
  other: "Other",
};
export const KIND_LABEL: Record<PaymentKind, string> = { payment: "Payment", refund: "Refund", cancellation_charge: "Cancellation charge" };

export interface BookingLine {
  id: string;
  lodge_name: string;
  property_id?: string | null;
  booking_no: string | null;
  check_in: string | null;
  check_out: string | null;
  rooms: number;
  nights: number;
  room_amount: number;
  safari_amount: number;
  transfer_amount: number;
  other_amount: number;
  sort: number;
}
export interface BookingPayment {
  id: string;
  line_id: string | null;
  kind: PaymentKind;
  amount: number;
  paid_on: string | null;
  mode: PaymentMode;
  reference: string | null;
  received_by: string | null;
  note: string | null;
  attachment_path: string | null;
  deleted_at?: string | null;
  created_at?: string;
}
export interface BookingDue {
  id: string;
  label: string;
  due_on: string;
  amount: number;
  sort: number;
}
export interface Booking {
  id: string;
  query_id: string | null;
  query_no?: string | null;
  version_no: number | null;
  guest_name: string;
  owner_id: string | null;
  check_in: string | null;
  check_out: string | null;
  currency: string;
  other_amount: number;
  discount_amount: number;
  booked_on: string | null;
  cancelled: boolean;
  cancelled_on: string | null;
  source: "quote" | "manual" | "import";
  notes: string | null;
  lines: BookingLine[];
  dues: BookingDue[];
  payments: BookingPayment[];
}

export type BookingStatus = "paid" | "part_paid" | "due_soon" | "overdue" | "not_paid" | "cancelled";
export const STATUS_TEXT: Record<BookingStatus, string> = {
  paid: "Paid",
  part_paid: "Partly paid",
  due_soon: "Due soon",
  overdue: "Overdue",
  not_paid: "Not paid yet",
  cancelled: "Cancelled",
};
// design-system tones (components/ui.tsx): green paid, yellow due / part paid, red overdue
export const STATUS_TONE: Record<BookingStatus, "success" | "warning" | "error" | "pending" | "neutral" | "info"> = {
  paid: "success",
  part_paid: "pending",
  due_soon: "warning",
  overdue: "error",
  not_paid: "info",
  cancelled: "neutral",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const live = (p: BookingPayment) => !p.deleted_at;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const lineTotal = (l: Pick<BookingLine, "room_amount" | "safari_amount" | "transfer_amount" | "other_amount">) =>
  r2(num(l.room_amount) + num(l.safari_amount) + num(l.transfer_amount) + num(l.other_amount));

// The trip value: the lodge lines, plus what is on the booking itself (markup, flights, city items),
// less a discount on the booking. Never below 0.
export function bookingTotal(b: Pick<Booking, "lines" | "other_amount" | "discount_amount">): number {
  return Math.max(0, r2(b.lines.reduce((t, l) => t + lineTotal(l), 0) + num(b.other_amount) - num(b.discount_amount)));
}

export interface Money {
  total: number; // the trip value
  received: number; // payments in
  refunded: number; // refunds out
  charges: number; // cancellation charges (what a cancelled booking still owes)
  net: number; // received - refunded
  owed: number; // total, or the cancellation charges once cancelled
  balance: number; // owed - net; below 0 = we hold more than is owed
  warning: string | null;
}

// Balance = what is owed - payments + refunds. A cancelled booking owes its cancellation charges
// only; holding more than that is a refund to make. Never below 0 without a warning.
export function money(b: Pick<Booking, "lines" | "other_amount" | "discount_amount" | "cancelled" | "payments">): Money {
  const ps = b.payments.filter(live);
  const sum = (k: PaymentKind) => r2(ps.filter((p) => p.kind === k).reduce((t, p) => t + num(p.amount), 0));
  const total = bookingTotal(b);
  const received = sum("payment");
  const refunded = sum("refund");
  const charges = sum("cancellation_charge");
  const net = r2(received - refunded);
  const owed = b.cancelled ? charges : total;
  const balance = r2(owed - net);
  let warning: string | null = null;
  if (balance < 0) warning = b.cancelled ? `Refund due to the guest: ${Math.abs(balance)}` : `Received more than the total by ${Math.abs(balance)}`;
  else if (net < 0) warning = `More refunded than received by ${Math.abs(net)}`;
  return { total, received, refunded, charges, net, owed, balance, warning };
}

// What has fallen due by a date and is not yet paid (the dues in date order, against the money in).
export function unpaidBy(b: Pick<Booking, "dues" | "lines" | "other_amount" | "discount_amount" | "cancelled" | "payments">, date: string): number {
  if (b.cancelled) return 0;
  const m = money(b);
  const due = b.dues.filter((d) => d.due_on <= date).reduce((t, d) => t + num(d.amount), 0);
  // never more than what is still owed in all
  return Math.max(0, Math.min(r2(due - m.net), m.balance));
}

// The next due date with money still unpaid on it, and how much.
export function nextDue(b: Pick<Booking, "dues" | "lines" | "other_amount" | "discount_amount" | "cancelled" | "payments">): { due_on: string; amount: number } | null {
  if (b.cancelled) return null;
  const m = money(b);
  if (m.balance <= 0) return null;
  let cum = 0;
  for (const d of [...b.dues].sort((x, y) => x.due_on.localeCompare(y.due_on) || x.sort - y.sort)) {
    cum = r2(cum + num(d.amount));
    if (cum > m.net + 0.5) return { due_on: d.due_on, amount: Math.min(r2(cum - m.net), m.balance) };
  }
  return null; // the dues are covered (the rest has no date yet)
}

export const DUE_SOON_DAYS = 7;

export function status(b: Pick<Booking, "dues" | "lines" | "other_amount" | "discount_amount" | "cancelled" | "payments">, today: string): BookingStatus {
  if (b.cancelled) return "cancelled";
  const m = money(b);
  if (m.balance <= 0 && (m.total > 0 || m.net > 0)) return "paid";
  if (unpaidBy(b, addDays(today, -1)) > 0) return "overdue";
  if (unpaidBy(b, addDays(today, DUE_SOON_DAYS)) > 0) return "due_soon";
  return m.net > 0 ? "part_paid" : "not_paid";
}

// Each lodge line's share of the money in: payments made for a line count there; the rest
// (payments for the whole booking) fill the lines in order. So a guest with three lodges and one
// payment, or a payment per lodge, both show right per line.
export function byLine(b: Pick<Booking, "lines" | "payments">): Map<string, { total: number; paid: number; balance: number }> {
  const out = new Map<string, { total: number; paid: number; balance: number }>();
  const lines = [...b.lines].sort((x, y) => x.sort - y.sort);
  const ps = b.payments.filter(live);
  const signed = (p: BookingPayment) => (p.kind === "payment" ? num(p.amount) : p.kind === "refund" ? -num(p.amount) : 0);
  for (const l of lines) {
    const paid = r2(ps.filter((p) => p.line_id === l.id).reduce((t, p) => t + signed(p), 0));
    out.set(l.id, { total: lineTotal(l), paid, balance: r2(lineTotal(l) - paid) });
  }
  let pool = r2(ps.filter((p) => !p.line_id || !out.has(p.line_id)).reduce((t, p) => t + signed(p), 0));
  for (const l of lines) {
    if (pool <= 0) break;
    const x = out.get(l.id)!;
    const take = Math.min(pool, Math.max(0, x.balance));
    x.paid = r2(x.paid + take);
    x.balance = r2(x.balance - take);
    pool = r2(pool - take);
  }
  // anything left over (more than the lines) shows on the last line
  if (pool > 0 && lines.length) {
    const x = out.get(lines[lines.length - 1].id)!;
    x.paid = r2(x.paid + pool);
    x.balance = r2(x.balance - pool);
  }
  return out;
}

// The dashboard cards and the list totals.
export interface Summary {
  value: number; // trip value of live bookings
  received: number; // net money in, all bookings
  balance: number; // still to come in (live bookings) + cancellation charges unpaid
  overdue: { count: number; amount: number };
  dueThisWeek: number; // falls due in the next 7 days, unpaid (not counting what is already overdue)
  receivedThisMonth: number; // payments less refunds dated this month
}
export function summarise(bookings: Booking[], today: string): Summary {
  const month = today.slice(0, 7);
  const s: Summary = { value: 0, received: 0, balance: 0, overdue: { count: 0, amount: 0 }, dueThisWeek: 0, receivedThisMonth: 0 };
  for (const b of bookings) {
    const m = money(b);
    if (!b.cancelled) s.value = r2(s.value + m.total);
    s.received = r2(s.received + m.net);
    if (m.balance > 0) s.balance = r2(s.balance + m.balance);
    const over = unpaidBy(b, addDays(today, -1));
    if (over > 0) {
      s.overdue.count++;
      s.overdue.amount = r2(s.overdue.amount + over);
    }
    s.dueThisWeek = r2(s.dueThisWeek + Math.max(0, unpaidBy(b, addDays(today, DUE_SOON_DAYS)) - over));
    for (const p of b.payments.filter(live)) {
      if (!p.paid_on || p.paid_on.slice(0, 7) !== month) continue;
      if (p.kind === "payment") s.receivedThisMonth = r2(s.receivedThisMonth + num(p.amount));
      if (p.kind === "refund") s.receivedThisMonth = r2(s.receivedThisMonth - num(p.amount));
    }
  }
  return s;
}

// A money amount typed by a person: rupees, 0 or more (or > 0), not text, not absurd.
export function parseMoney(v: unknown, opts: { positive?: boolean } = {}): number | null {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
  const t = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, "").replace(/^(rs\.?|inr)/i, ""));
  if (!Number.isFinite(t) || t < 0 || t > 100_000_000) return null;
  if (opts.positive && t <= 0) return null;
  return r2(t);
}
