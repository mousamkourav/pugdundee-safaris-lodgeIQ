// Red Panda Outpost as a stop in a Sales (Safari) trip: Delhi - Red Panda - Kaziranga, or any mix
// (owner, 6 Nov 2026). Pure; used by the Sales pricing engine for the nights at the Outpost.
//
// The Outpost is a lodge in Sales Master data (supabase/red_panda_in_sales.sql: park Singalila,
// lodge "Red Panda Outpost" (own lodge), a twin room, the roads from Bagdogra / Bhadrapur airports
// and Mayfair at Rs 0 (the transfer is in the package), its day texts and includes). Its nights are
// priced from the Red Panda tariff (rp_tariff), never from room rates:
//   one night = (per person rate for the group size x guests + single room supplements) / 5 nights
// so 4, 5, 6... nights are pro rata, + GST 5%. Market: an agent = B2B, else foreign / Indian.
// The lines are room lines of our own lodge: lodge discounts, multi-lodge offers, whole-trip
// discount and markup apply as at our other lodges. The Sales payment schedule applies.
// Only people with Red Panda access get the tariff (`PricingData.redPanda`); for anyone else a
// Red Panda stop is an error, never a price.
import type { Market, RpSupplementRow, RpTariffRow } from "./types";

export interface RpSalesPricing {
  tariff: RpTariffRow[];
  supplements: RpSupplementRow[];
  gst_pct: number;
  package_nights: number;
  min_nights: number;
  max_guests: number;
  min_age: number;
  closed_months: number[];
}

// the Outpost in Sales Master data, by its name
export const isRedPandaName = (name: string | null | undefined) => /\bred\s*panda\b/i.test(name ?? "");

export const MARKET_TEXT: Record<Market, string> = { b2b: "B2B", foreign: "B2C foreign", indian: "B2C Indian" };

export function salesMarket(b2b: boolean, nationality: string): Market {
  return b2b ? "b2b" : nationality === "indian" ? "indian" : "foreign";
}

// The tariff row for a night (by date), or for dates not fixed (the season after the booking date,
// or the one after that for "next year").
export function tariffFor(rp: RpSalesPricing, market: Market, guests: number, night: string | null, basis: { year: string } | null, today: string): RpTariffRow | null {
  const g = Math.min(Math.max(guests, 1), 10);
  const rows = rp.tariff.filter((t) => t.active && t.market === market && t.guests === g).sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  if (night && !basis) return rows.find((t) => t.valid_from <= night && night <= t.valid_to) ?? null;
  const open = rows.filter((t) => t.valid_to >= today);
  return (basis?.year === "next" ? open[1] : open[0]) ?? null;
}

export function supplementFor(rp: RpSalesPricing, market: Market, kind: "single_room" | "tour_leader", season: RpTariffRow): number | null {
  const s = rp.supplements.find((x) => x.active && x.market === market && x.kind === kind && x.valid_from === season.valid_from);
  return s ? s.amount : null;
}

// Checks for the stop (errors, never prices): ages, group size, monsoon, nights.
export function rpStopProblems(rp: RpSalesPricing, o: { name: string; adults: number; children: number[]; nights: string[]; dateless: boolean; rooms: number }): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const guests = o.adults + o.children.length;
  const young = o.children.filter((a) => a < rp.min_age);
  if (young.length) errors.push(`${o.name} takes guests from ${rp.min_age} years: ${young.length === 1 ? `the child of ${young[0]}` : `the children of ${young.join(", ")}`} cannot go. Take Red Panda out of the trip, or change the guests.`);
  if (guests > rp.max_guests) errors.push(`${o.name} takes up to ${rp.max_guests} guests (this trip has ${guests}).`);
  if (o.rooms < Math.ceil(guests / 2)) errors.push(`${o.name}: ${guests} guests need at least ${Math.ceil(guests / 2)} rooms (2 per room, twin beds).`);
  if (!o.dateless) {
    const closed = [...new Set(o.nights.filter((d) => rp.closed_months.includes(Number(d.slice(5, 7)))).map((d) => d.slice(0, 7)))];
    if (closed.length) errors.push(`${o.name} is closed June to September (monsoon): the stay falls on ${closed.length === 1 ? "a closed month" : "closed months"}.`);
  }
  if (o.nights.length < rp.min_nights) errors.push(`${o.name}: at least ${rp.min_nights} nights (the package is ${rp.package_nights}).`);
  else if (o.nights.length < rp.package_nights) warnings.push(`${o.name}: ${o.nights.length} nights, shorter than the ${rp.package_nights}-night package, priced pro rata. Check with the team that it is possible.`);
  return { errors, warnings };
}

// One night at the Outpost, before GST: the group's package / package nights.
export function rpNight(rp: RpSalesPricing, o: { market: Market; guests: number; rooms: number; night: string | null; basis: { year: string } | null; today: string }): { base: number; season: string; perPax: number; extraRooms: number } | null {
  const row = tariffFor(rp, o.market, o.guests, o.night, o.basis, o.today);
  if (!row) return null;
  const extraRooms = Math.max(0, o.rooms - Math.ceil(o.guests / 2));
  const single = extraRooms ? supplementFor(rp, o.market, "single_room", row) : 0;
  if (single == null) return null;
  const pkg = row.per_pax * o.guests + extraRooms * single;
  return { base: pkg / Math.max(1, rp.package_nights), season: row.season, perPax: row.per_pax, extraRooms };
}
