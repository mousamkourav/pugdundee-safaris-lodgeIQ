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

export async function loadPricingData(): Promise<{ data: PricingData; error: string | null }> {
  const supabase = await createClient();
  const q = (table: string, active = true) => {
    const base = supabase.from(table).select("*");
    return active ? base.eq("active", true) : base;
  };

  const [props, rooms, rates, parks, closures, safaris, locs, transfers, addons, offers, settings] = await Promise.all([
    q("sales_properties"),
    q("sales_room_categories"),
    q("sales_room_rates"),
    q("sales_parks"),
    q("sales_park_closures", false),
    q("sales_safari_rates"),
    q("sales_locations"),
    q("sales_transfer_rates"),
    q("sales_addons"),
    q("sales_offers"),
    supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle(),
  ]);

  const firstError = [props, rooms, rates, parks, closures, safaris, locs, transfers, addons, offers, settings].find((r) => r.error)?.error;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

  const s = ((settings.data as { data?: Row } | null)?.data ?? {}) as Row;
  const fx = (s.fx ?? null) as { USD?: unknown } | null;

  const data: PricingData = {
    properties: rows(props).map((r): Property => ({ id: str(r.id), name: str(r.name), park_id: strOrNull(r.park_id) })),
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
    roomRates: rows(rates).map(
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
      })
    ),
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
    addons: rows(addons).map(
      (r): Addon => ({
        id: str(r.id),
        name: str(r.name),
        property_id: strOrNull(r.property_id),
        pricing_unit: str(r.pricing_unit) as Addon["pricing_unit"],
        rate: num(r.rate),
        tax_pct: num(r.tax_pct),
        active: true,
      })
    ),
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
        combinable: !!r.combinable,
        active: true,
      })
    ),
    settings: {
      markup_pct: numOrNull(s.markup_pct),
      fx: fx ? { USD: numOrNull(fx.USD) } : null,
      payment_slabs: Array.isArray(s.payment_slabs)
        ? (s.payment_slabs as Row[]).map((p): PaymentSlab => ({
            label: str(p.label) || "Instalment",
            pct: num(p.pct),
            days_before_arrival: numOrNull(p.days_before_arrival),
          }))
        : null,
      per_person_basis: s.per_person_basis === "adults" ? "adults" : "guests",
    } satisfies PricingSettings,
  };

  return { data, error: firstError ? firstError.message : null };
}
