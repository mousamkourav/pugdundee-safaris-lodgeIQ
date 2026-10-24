// The Pugdundee tariff, turned into per-room rates the pricing engine reads.
//   rate category (Cottage, Tree House...) x nationality x season, valid for a year
//   + one season calendar (Shoulder / High / Peak date ranges; long weekends are Peak)
// Every room type pointing to a category gets that category's rates. A lodge-specific
// room rate (Master data > Lodge exceptions) still wins over the tariff.

import type { ChildRate, ISODate, RoomRate } from "./types";

export interface TariffRow {
  id: string;
  rate_category_id: string;
  nationality: "all" | "indian" | "foreign";
  season: "all" | "shoulder" | "high" | "peak";
  valid_from: ISODate;
  valid_to: ISODate;
  meal_plan: string;
  rate_single: number | null;
  rate_double: number;
  weekend_rate_single: number | null;
  weekend_rate_double: number | null;
  weekend_days: number[];
  extra_adult_pct: number;
  child_free_under: number;
  child_5_12_pct: number;
  child_13_17_pct: number;
  min_nights: number;
  tax_pct: number;
  rates_include_tax: boolean;
}
export interface CalendarRange {
  calendar: string;
  season: "shoulder" | "high" | "peak";
  date_from: ISODate;
  date_to: ISODate;
}
export interface RateCategory {
  id: string;
  calendar: string;
}

const PRIORITY = { all: 1, shoulder: 2, high: 2, peak: 3 } as const; // long weekends beat the season around them
// the note tells the season to quotes without fixed dates (engine: seasonOfRate)
const SEASON_NOTE = { all: "All year.", shoulder: "Shoulder.", high: "High.", peak: "Peak." } as const;
const later = (a: ISODate, b: ISODate) => (a > b ? a : b);
const earlier = (a: ISODate, b: ISODate) => (a < b ? a : b);

function childBands(t: TariffRow, dbl: number): ChildRate[] {
  const pct = (p: number) => Math.round((dbl * p) / 100);
  const free = Math.max(0, Math.min(12, t.child_free_under));
  return [
    ...(free > 0 ? [{ min_age: 0, max_age: free - 1, rate: 0 }] : []),
    { min_age: free, max_age: 12, rate: pct(t.child_5_12_pct) },
    { min_age: 13, max_age: 17, rate: pct(t.child_13_17_pct) },
  ];
}

export function compileTariff(
  tariff: TariffRow[],
  calendar: CalendarRange[],
  categories: RateCategory[],
  rooms: { id: string; rate_category_id: string | null }[]
): RoomRate[] {
  const out: RoomRate[] = [];
  for (const t of tariff) {
    const cat = categories.find((c) => c.id === t.rate_category_id);
    if (!cat) continue;
    const targets = rooms.filter((r) => r.rate_category_id === t.rate_category_id);
    if (!targets.length) continue;
    // the date ranges this row covers: the whole year, or its season's ranges inside the year
    const ranges =
      t.season === "all"
        ? [{ from: t.valid_from, to: t.valid_to }]
        : calendar
            .filter((c) => c.calendar === cat.calendar && c.season === t.season && c.date_to >= t.valid_from && c.date_from <= t.valid_to)
            .map((c) => ({ from: later(c.date_from, t.valid_from), to: earlier(c.date_to, t.valid_to) }));
    for (const room of targets) {
      ranges.forEach((rg, k) =>
        out.push({
          id: `tariff:${t.id}:${room.id}:${k}`,
          room_category_id: room.id,
          valid_from: rg.from,
          valid_to: rg.to,
          meal_plan: t.meal_plan,
          rate_single: t.rate_single,
          rate_double: t.rate_double,
          extra_adult: Math.round((t.rate_double * t.extra_adult_pct) / 100),
          child_rates: childBands(t, t.rate_double),
          weekend_days: t.weekend_days,
          weekend_rate_single: t.weekend_rate_single,
          weekend_rate_double: t.weekend_rate_double,
          min_nights: t.min_nights,
          tax_pct: t.tax_pct,
          rates_include_tax: t.rates_include_tax,
          active: true,
          nationality: t.nationality,
          priority: PRIORITY[t.season],
          notes: SEASON_NOTE[t.season],
        })
      );
    }
  }
  return out;
}
