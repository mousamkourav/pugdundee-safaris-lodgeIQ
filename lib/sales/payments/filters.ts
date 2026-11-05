// The Payments list filters (also used by the Excel export, so the file is what the screen shows).
import { status, type Booking, type BookingStatus } from "./money";

export interface PaymentFilters {
  month?: string; // check-in month, YYYY-MM
  status?: BookingStatus | "";
  lodge?: string;
  owner?: string;
  q?: string; // guest, booking no. or query no.
}

export function readFilters(sp: Record<string, string | string[] | undefined>): PaymentFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 100) ?? "";
  };
  const month = one("month");
  const st = one("status");
  return {
    month: /^\d{4}-\d{2}$/.test(month) ? month : "",
    status: ["paid", "part_paid", "due_soon", "overdue", "not_paid", "cancelled"].includes(st) ? (st as BookingStatus) : "",
    lodge: one("lodge"),
    owner: /^[0-9a-f-]{36}$/i.test(one("owner")) ? one("owner") : "",
    q: one("q"),
  };
}

export function filterBookings(bookings: Booking[], f: PaymentFilters, today: string): Booking[] {
  const q = (f.q ?? "").toLowerCase();
  return bookings.filter((b) => {
    if (f.month && !(b.check_in ?? "").startsWith(f.month) && !b.lines.some((l) => (l.check_in ?? "").startsWith(f.month!))) return false;
    if (f.status && status(b, today) !== f.status) return false;
    if (f.lodge && !b.lines.some((l) => l.lodge_name === f.lodge)) return false;
    if (f.owner && b.owner_id !== f.owner) return false;
    if (q && !b.guest_name.toLowerCase().includes(q) && !b.lines.some((l) => (l.booking_no ?? "").toLowerCase().includes(q)) && !(b.query_no ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
}

export const filterQuery = (f: PaymentFilters) =>
  new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
