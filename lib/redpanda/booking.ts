// The Payments tracker lines of a booked Red Panda quote (pure; used by
// lib/sales/payments/from-version.ts): one line for Red Panda Outpost (the package with markup,
// discount and GST) and one per hotel stay (Delhi, near Bagdogra: room + its transfers, with tax). Flights stay on the booking.
// Typed extras and the adjustment stay on the booking itself (the rest of the total).
import type { RpPrice } from "./types";

export interface RpBookingLine {
  lodge_name: string;
  property_id: string | null;
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

const nightsBetween = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)) : 0);

export function rpBookingLines(p: RpPrice): RpBookingLine[] {
  if (!p || !p.totals || !Array.isArray(p.lines)) return [];
  const out: RpBookingLine[] = [];
  const pkg = Math.max(0, p.totals.package + p.totals.markup - p.totals.discount + p.totals.package_gst);
  const rooms = Math.max(1, p.rooms || 1);
  const hotel = (key: string, check_in: string | null, check_out: string | null) => {
    const stay = p.lines.find((l) => l.key === key);
    if (!stay) return;
    const cars = p.lines.filter((l) => l.key.startsWith(`${key}_transfer`));
    out.push({
      lodge_name: stay.label.split(",")[0] || "Hotel",
      property_id: null,
      check_in,
      check_out,
      rooms,
      nights: nightsBetween(check_in, check_out),
      room_amount: stay.amount + stay.gst,
      safari_amount: 0,
      transfer_amount: cars.reduce((t, c) => t + c.amount + c.gst, 0),
      other_amount: 0,
      sort: out.length,
    });
  };
  const d = p.dates;
  hotel("delhi_before", p.arrival, d?.bagdogra_in ?? null);
  hotel("hotel_before", d?.bagdogra_in ?? p.arrival, p.outpost?.check_in ?? null);
  out.push({
    lodge_name: "Red Panda Outpost",
    property_id: null,
    check_in: p.outpost?.check_in ?? null,
    check_out: p.outpost?.check_out ?? null,
    rooms,
    nights: nightsBetween(p.outpost?.check_in ?? null, p.outpost?.check_out ?? null),
    room_amount: pkg,
    safari_amount: 0,
    transfer_amount: 0,
    other_amount: 0,
    sort: out.length,
  });
  hotel("hotel_after", p.outpost?.check_out ?? null, d?.delhi_back ?? p.departure);
  hotel("delhi_after", d?.delhi_back ?? null, p.departure);
  return out;
}
