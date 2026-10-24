import { liveFx } from "@/lib/sales/fx";
import { compileTariff, type CalendarRange, type RateCategory, type TariffRow } from "@/lib/sales/pricing/tariff";
// Loads master data from Supabase in the shape the pricing engine expects.
// Server-side only (uses the signed-in user's client; sales users can read
// all sales_* master tables through RLS).
import { createClient } from "@/lib/supabase/server";
import type {
  Addon,
  ChildRate,
  Location,
  Offer,
  Park,
  ParkClosure,
  PaymentSlab,
  PricingData,
  PricingSettings,
  Property,
  RateHike,
  RoomCategory,
  RoomRate,
  SafariRate,
  TransferRate,
} from "./types";

type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0) => (v === null || v === undefined || v === "" ? fallback : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const date = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const arr = <T>(v: unknown, map: (x: unknown) => T): T[] => (Array.isArray(v) ? v.map(map) : []);

// The yearly hike from Sales settings; only when it has dates and at least one %.
function hikeOf(v: unknown): RateHike | null {
  const h = (v ?? {}) as Row;
  const from = date(h.from);
  const to = date(h.to);
  const pct = (x: unknown) => Math.max(-50, Math.min(100, num(x)));
  const out = { label: str(h.label) || "next season", from: from!, to: to!, hotels_pct: pct(h.hotels_pct), safaris_pct: pct(h.safaris_pct), transfers_pct: pct(h.transfers_pct) };
  if (!from || !to || to < from) return null;
  return out.hotels_pct || out.safaris_pct || out.transfers_pct ? out : null;
}

export async function loadPricingData(): Promise<{ data: PricingData; error: string | null }> {
  const supabase = await createClient();
  const q = (table: string, active = true) => {
    const base = supabase.from(table).select("*");
    return active ? base.eq("active", true) : base;
  };

  const [props, rooms, rates, parks, closures, safaris, locs, transfers, addons, offers, settings, tariff, calendar, categories] = await Promise.all([
    q("sales_properties"),
    q("sales_room_categories"),
    q("sales_room_rates"),
    q("sales_parks"),
    q("sales_park_closures", false),
    q("sales_safari_rates"),
    q("sales_locations"),
    q("sales_transfer_rates"),
    q("sales_addons", false), // merged rows too, so saved quotes still price
    q("sales_offers"),
    supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle(),
    // the Pugdundee tariff (sales_tariff_v1.sql); if absent, lodge rates only
    q("sales_tariff"),
    q("sales_tariff_calendar"),
    q("sales_rate_categories"),
  ]);

  const firstError = [props, rooms, rates, parks, closures, safaris, locs, transfers, addons, offers, settings].find((r) => r.error)?.error;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

  const s = ((settings.data as { data?: Row } | null)?.data ?? {}) as Row;
  const fx = (s.fx ?? null) as Record<string, unknown> | null;
  // Live ECB rates first; the rates saved in Sales settings when the service is unreachable
  // (or when the admin chose manual rates).
  const live = s.fx_mode === "manual" ? null : await liveFx();

  const data: PricingData = {
    properties: rows(props).map((r): Property => ({ id: str(r.id), name: str(r.name), park_id: strOrNull(r.park_id), kind: str(r.kind) || "own_lodge" })),
    rooms: rows(rooms).map(
      (r): RoomCategory => ({
        id: str(r.id),
        property_id: str(r.property_id),
        name: str(r.name),
        max_adults: num(r.max_adults, 2),
        max_children: num(r.max_children, 1),
        extra_bed: !!r.extra_bed,
      })
    ),
    roomRates: [
      // the Pugdundee tariff, as per-room rates (their note tells the season)
      ...compileTariff(
        tariff.error ? [] : rows(tariff).map(
          (r): TariffRow => ({
            id: str(r.id),
            rate_category_id: str(r.rate_category_id),
            nationality: (["indian", "foreign"].includes(str(r.nationality)) ? str(r.nationality) : "all") as TariffRow["nationality"],
            season: (["shoulder", "high", "peak"].includes(str(r.season)) ? str(r.season) : "all") as TariffRow["season"],
            valid_from: date(r.valid_from)!,
            valid_to: date(r.valid_to)!,
            meal_plan: str(r.meal_plan) || "AP",
            rate_single: numOrNull(r.rate_single),
            rate_double: num(r.rate_double),
            weekend_rate_single: numOrNull(r.weekend_rate_single),
            weekend_rate_double: numOrNull(r.weekend_rate_double),
            weekend_days: arr(r.weekend_days, (d) => num(d)),
            extra_adult_pct: num(r.extra_adult_pct, 40),
            child_free_under: num(r.child_free_under, 5),
            child_5_12_pct: num(r.child_5_12_pct, 25),
            child_13_17_pct: num(r.child_13_17_pct, 40),
            min_nights: num(r.min_nights, 2),
            tax_pct: num(r.tax_pct, 18),
            rates_include_tax: r.rates_include_tax === true,
          })
        ),
        calendar.error ? [] : rows(calendar).map((r): CalendarRange => ({ calendar: str(r.calendar) || "pugdundee", season: str(r.season) as CalendarRange["season"], date_from: date(r.date_from)!, date_to: date(r.date_to)! })),
        categories.error ? [] : rows(categories).map((r): RateCategory => ({ id: str(r.id), calendar: str(r.calendar) || "pugdundee" })),
        rows(rooms).map((r) => ({ id: str(r.id), rate_category_id: strOrNull(r.rate_category_id) }))
      ),
      // lodge-specific exceptions (Master data > Lodge exceptions) win over the tariff
      ...rows(rates).map(
      (r): RoomRate => ({
        id: str(r.id),
        room_category_id: str(r.room_category_id),
        valid_from: date(r.valid_from)!,
        valid_to: date(r.valid_to)!,
        meal_plan: str(r.meal_plan),
        rate_single: numOrNull(r.rate_single),
        rate_double: num(r.rate_double),
        extra_adult: numOrNull(r.extra_adult),
        child_rates: arr(r.child_rates, (c) => {
          const o = (c ?? {}) as Row;
          return { min_age: num(o.min_age), max_age: num(o.max_age), rate: num(o.rate) } as ChildRate;
        }),
        weekend_days: arr(r.weekend_days, (d) => num(d)),
        weekend_rate_single: numOrNull(r.weekend_rate_single),
        weekend_rate_double: numOrNull(r.weekend_rate_double),
        min_nights: num(r.min_nights, 1),
        tax_pct: num(r.tax_pct),
        rates_include_tax: r.rates_include_tax !== false,
        active: true,
        notes: strOrNull(r.notes),
        nationality: (["indian", "foreign"].includes(str(r.nationality)) ? str(r.nationality) : "all") as RoomRate["nationality"],
        priority: 10,
      })
    ),
    ],
    parks: rows(parks).map((r): Park => ({ id: str(r.id), name: str(r.name) })),
    closures: rows(closures).map(
      (r): ParkClosure => ({
        park_id: str(r.park_id),
        zone: str(r.zone) as ParkClosure["zone"],
        closure_type: str(r.closure_type) as ParkClosure["closure_type"],
        weekday: numOrNull(r.weekday),
        session: str(r.session) as ParkClosure["session"],
        date_from: date(r.date_from),
        date_to: date(r.date_to),
        label: strOrNull(r.label),
      })
    ),
    safariRates: rows(safaris).map(
      (r): SafariRate => ({
        id: str(r.id),
        park_id: str(r.park_id),
        zone: str(r.zone) as SafariRate["zone"],
        vehicle_type: str(r.vehicle_type),
        session: str(r.session) as SafariRate["session"],
        pricing_unit: str(r.pricing_unit) as SafariRate["pricing_unit"],
        nationality: str(r.nationality) as SafariRate["nationality"],
        valid_from: date(r.valid_from)!,
        valid_to: date(r.valid_to)!,
        weekday_rate: num(r.weekday_rate),
        weekend_rate: numOrNull(r.weekend_rate),
        weekend_days: arr(r.weekend_days, (d) => num(d)),
        max_pax: num(r.max_pax, 6),
        naturalist_fee: num(r.naturalist_fee),
        guide_fee: num(r.guide_fee),
        tax_pct: num(r.tax_pct),
        active: true,
        book_min_days: numOrNull(r.book_min_days),
        book_max_days: numOrNull(r.book_max_days),
      })
    ),
    locations: rows(locs).map((r): Location => ({ id: str(r.id), name: str(r.name), property_id: strOrNull(r.property_id) })),
    transferRates: rows(transfers).map(
      (r): TransferRate => ({
        id: str(r.id),
        from_location_id: str(r.from_location_id),
        to_location_id: str(r.to_location_id),
        vehicle_type: str(r.vehicle_type),
        capacity: num(r.capacity, 4),
        rate: num(r.rate),
        drive_hours: numOrNull(r.drive_hours),
        night_surcharge: num(r.night_surcharge),
        valid_from: date(r.valid_from),
        valid_to: date(r.valid_to),
        bidirectional: r.bidirectional !== false,
        tax_pct: num(r.tax_pct),
        active: true,
      })
    ),
    addons: (() => {
      const all = rows(addons);
      const tiersOf = (v: unknown) =>
        Array.isArray(v)
          ? v.map((t) => ({ max_guests: num((t as Row).max_guests), rate: num((t as Row).rate) })).filter((t) => t.max_guests > 0).sort((a, b) => a.max_guests - b.max_guests)
          : null;
      const toAddon = (r: Row, alias = false): Addon => ({
        id: str(r.id),
        name: str(r.name),
        property_id: strOrNull(r.property_id),
        pricing_unit: str(r.pricing_unit) as Addon["pricing_unit"],
        rate: num(r.rate),
        tax_pct: num(r.tax_pct),
        active: true,
        // columns added in sales_v2_itinerary_fixes.sql (absent before it is run)
        min_guests: numOrNull(r.min_guests),
        included_guests: numOrNull(r.included_guests),
        extra_guest_rate: numOrNull(r.extra_guest_rate),
        unavailable_weekdays: arr(r.unavailable_weekdays, (d) => num(d)),
        availability_note: strOrNull(r.availability_note),
        // columns added in sales_tariff_v1.sql
        rate_foreign: numOrNull(r.rate_foreign),
        extra_guest_rate_foreign: numOrNull(r.extra_guest_rate_foreign),
        max_guests: numOrNull(r.max_guests),
        tiers: tiersOf(r.tiers),
        tiers_foreign: tiersOf(r.tiers_foreign),
        offered_at: arr(r.offered_at, (x) => str(x)),
        ...(alias ? { alias: true } : {}),
      });
      const live = all.filter((r) => r.active !== false);
      // a merged row keeps its id (saved quotes use it) but prices like the row it joined
      const aliases = all
        .filter((r) => r.active === false && r.merged_into)
        .map((r) => {
          const target = live.find((x) => x.id === r.merged_into);
          return target ? { ...toAddon(target, true), id: str(r.id) } : null;
        })
        .filter((x): x is Addon => !!x);
      return [...live.map((r) => toAddon(r)), ...aliases];
    })(),
    offers: rows(offers).map(
      (r): Offer => ({
        id: str(r.id),
        name: str(r.name),
        offer_type: str(r.offer_type) as Offer["offer_type"],
        value: numOrNull(r.value),
        stay_nights: numOrNull(r.stay_nights),
        pay_nights: numOrNull(r.pay_nights),
        applies_to: arr(r.applies_to, str),
        property_ids: arr(r.property_ids, str),
        room_category_ids: arr(r.room_category_ids, str),
        book_from: date(r.book_from),
        book_to: date(r.book_to),
        travel_from: date(r.travel_from),
        travel_to: date(r.travel_to),
        min_nights: num(r.min_nights, 1),
        min_lodges: numOrNull(r.min_lodges),
        combinable: !!r.combinable,
        active: true,
      })
    ),
    settings: {
      markup_pct: numOrNull(s.markup_pct),
      fx: {
        USD: live?.rates.USD ?? numOrNull(fx?.USD),
        EUR: live?.rates.EUR ?? numOrNull(fx?.EUR),
        GBP: live?.rates.GBP ?? numOrNull(fx?.GBP),
        AUD: live?.rates.AUD ?? numOrNull(fx?.AUD),
      },
      fx_source: live ? `ECB rate of ${live.date}` : "rate saved in Sales settings",
      fx_margin_pct: numOrNull(s.fx_margin_pct),
      safari_weekend_ranges: Array.isArray(s.safari_weekend_ranges)
        ? (s.safari_weekend_ranges as Row[]).map((x) => ({ from: str(x.from), to: str(x.to) })).filter((x) => /^\d{2}-\d{2}$/.test(x.from) && /^\d{2}-\d{2}$/.test(x.to))
        : null,
      payment_slabs: Array.isArray(s.payment_slabs)
        ? (s.payment_slabs as Row[]).map((p): PaymentSlab => ({
            label: str(p.label) || "Instalment",
            pct: num(p.pct),
            days_before_arrival: numOrNull(p.days_before_arrival),
          }))
        : null,
      per_person_basis: s.per_person_basis === "adults" ? "adults" : "guests",
      hike: hikeOf(s.rate_hike),
    } satisfies PricingSettings,
  };

  return { data, error: firstError ? firstError.message : null };
}
