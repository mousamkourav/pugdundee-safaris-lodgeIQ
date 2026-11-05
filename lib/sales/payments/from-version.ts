// A booking made from a booked quote (the latest version): one line per lodge or hotel it bills,
// with its dates, rooms, nights and room / safari / transfer / other amounts (incl. GST) from the
// costing; what is not billed to a lodge (markup, flights, typed items) on the booking itself; the
// dues from the quote's payment schedule; the payment recorded when it was marked Booked. Pure.
import type { Plan } from "@/lib/sales/plan/types";
import type { PriceResult } from "@/lib/sales/pricing/types";
import { addDays, type PaymentMode } from "./money";

export interface QueryForBooking {
  id: string;
  guest_name: string;
  assigned_to: string | null;
  booked_at: string | null; // timestamp
  booked_amount: number | null;
  payment_ref: string | null;
}
export interface VersionForBooking {
  version_no: number;
  currency: string | null;
  plan: Plan;
  pricing: PriceResult;
}
export interface BookingDraft {
  booking: {
    query_id: string;
    version_no: number;
    guest_name: string;
    owner_id: string | null;
    check_in: string | null;
    check_out: string | null;
    currency: string;
    other_amount: number;
    discount_amount: number;
    booked_on: string;
    source: "quote";
  };
  lines: { lodge_name: string; property_id: string | null; check_in: string | null; check_out: string | null; rooms: number; nights: number; room_amount: number; safari_amount: number; transfer_amount: number; other_amount: number; sort: number }[];
  dues: { label: string; due_on: string; amount: number; sort: number }[];
  payment: { kind: "payment"; amount: number; paid_on: string; mode: PaymentMode; reference: string | null; note: string } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const isUuid = (s: string | null) => !!s && /^[0-9a-f-]{36}$/i.test(s);
const CURRENCIES = new Set(["INR", "USD", "EUR", "GBP", "AUD"]);

export function bookingFromVersion(q: QueryForBooking, v: VersionForBooking, today: string): BookingDraft {
  const plan = v.plan;
  const pr = v.pricing;
  const booked = q.booked_at ? q.booked_at.slice(0, 10) : today;
  const days = plan.days ?? [];
  // the nights at each lodge or hotel, from the days (where the guests sleep)
  const nightsAt = (pid: string) => days.filter((d) => d.property_id === pid || d.city_hotel?.property_id === pid).map((d) => d.date).sort();
  const rooms = Math.max(1, Number(plan.guest?.rooms) || 1);

  const lines: BookingDraft["lines"] = [];
  for (const t of pr.byProperty ?? []) {
    if (!t.property_id) continue; // not billed to a lodge: on the booking (below)
    const nights = nightsAt(t.property_id);
    // the lodge's discount comes off its room amount (amounts are never below 0)
    const room = r2(Math.max(0, t.room + Math.min(0, t.discount)));
    lines.push({
      lodge_name: t.name || "Lodge",
      property_id: isUuid(t.property_id) ? t.property_id : null,
      check_in: nights[0] ?? null,
      check_out: nights.length ? addDays(nights[nights.length - 1], 1) : null,
      rooms,
      nights: nights.length,
      room_amount: room,
      safari_amount: r2(Math.max(0, t.safari)),
      transfer_amount: r2(Math.max(0, t.transfer)),
      other_amount: r2(Math.max(0, t.addon)),
      sort: lines.length,
    });
  }
  const linesTotal = r2(lines.reduce((s, l) => s + l.room_amount + l.safari_amount + l.transfer_amount + l.other_amount, 0));
  const rest = r2(pr.totals.grand - linesTotal); // markup, flights, typed items, adjustment, package GST
  const checkIn = pr.arrival ?? days[0]?.date ?? null;
  const checkOut = pr.departure ?? (days.length ? days[days.length - 1].date : null);

  // the payment schedule of the quote; "at booking" (or a date already past) = the booked day,
  // "N days before arrival" without a date = from the arrival
  const dues: BookingDraft["dues"] = (pr.payments ?? [])
    .filter((p) => p.amount > 0)
    .map((p, i) => {
      let due = p.due;
      const before = /(\d+)\s+days?\s+before/i.exec(p.note ?? "");
      if (!due && before && checkIn) due = addDays(checkIn, -Number(before[1]));
      return { label: p.label, due_on: due && due > booked ? due : booked, amount: r2(p.amount), sort: i };
    });

  const amount = Number(q.booked_amount) || 0;
  return {
    booking: {
      query_id: q.id,
      version_no: v.version_no,
      guest_name: (q.guest_name || "Guest").slice(0, 200),
      owner_id: q.assigned_to,
      check_in: checkIn,
      check_out: checkOut && checkIn && checkOut < checkIn ? checkIn : checkOut,
      currency: CURRENCIES.has(String(v.currency ?? pr.currency)) ? String(v.currency ?? pr.currency) : "INR",
      other_amount: rest > 0 ? rest : 0,
      discount_amount: rest < 0 ? -rest : 0,
      booked_on: booked,
      source: "quote",
    },
    lines,
    dues,
    payment: amount > 0 ? { kind: "payment", amount: r2(amount), paid_on: booked, mode: "other", reference: q.payment_ref?.slice(0, 200) || null, note: "Recorded when the query was marked Booked" } : null,
  };
}
