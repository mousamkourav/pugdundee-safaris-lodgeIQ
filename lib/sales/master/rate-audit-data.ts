// Server side of "Rate audit": reads Master data, then lib/sales/master/rate-audit.ts
// compares it with the owner's documents (lib/sales/master/rate-card.ts).
import { createClient } from "@/lib/supabase/server";
import { mealCode } from "@/lib/sales/pricing/meal";
import { auditRates, type AuditRow } from "./rate-audit";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const nn = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const d = (v: unknown) => s(v).slice(0, 10);
const nat = (v: unknown) => (["indian", "foreign"].includes(s(v)) ? s(v) : "all");
const tiers = (v: unknown) =>
  Array.isArray(v) ? v.map((t) => ({ max_guests: n((t as Row)?.max_guests), rate: n((t as Row)?.rate) })) : null;

export async function loadRateAudit(): Promise<{ rows: AuditRow[]; error: string | null }> {
  const supabase = await createClient();
  const all = (table: string) => supabase.from(table).select("*");
  const [props, locs, rooms, rates, transfers, addons, parks, safaris, tariff, categories, calendar] = await Promise.all([
    all("sales_properties"),
    all("sales_locations"),
    all("sales_room_categories"),
    all("sales_room_rates"),
    all("sales_transfer_rates"),
    all("sales_addons"),
    all("sales_parks"),
    all("sales_safari_rates"),
    all("sales_tariff"),
    all("sales_rate_categories"),
    all("sales_tariff_calendar"),
  ]);
  // the tariff tables are optional (before sales_tariff_v1.sql): an error there only empties them
  const error = [props, locs, rooms, rates, transfers, addons, parks, safaris].find((r) => r.error)?.error?.message ?? null;
  const rows = (r: { data: unknown; error?: unknown }) => (r.error ? [] : ((r.data ?? []) as Row[]));
  const active = (r: Row) => r.active !== false;
  return {
    error,
    rows: auditRates({
      properties: rows(props).filter(active).map((r) => ({ id: s(r.id), name: s(r.name), kind: s(r.kind), park_id: r.park_id ? s(r.park_id) : null })),
      locations: rows(locs).filter(active).map((r) => ({ id: s(r.id), name: s(r.name), type: s(r.type), property_id: r.property_id ? s(r.property_id) : null })),
      rooms: rows(rooms).filter(active).map((r) => ({ id: s(r.id), property_id: s(r.property_id), name: s(r.name), rate_category_id: r.rate_category_id ? s(r.rate_category_id) : null })),
      roomRates: rows(rates).map((r) => ({
        room_category_id: s(r.room_category_id),
        valid_from: d(r.valid_from),
        valid_to: d(r.valid_to),
        meal_plan: mealCode(r.meal_plan),
        rate_single: nn(r.rate_single),
        rate_double: n(r.rate_double),
        weekend_rate_double: nn(r.weekend_rate_double),
        tax_pct: n(r.tax_pct),
        rates_include_tax: r.rates_include_tax !== false, // as the pricing engine reads it
        nationality: nat(r.nationality),
        active: active(r),
      })),
      transfers: rows(transfers).map((r) => ({ from_location_id: s(r.from_location_id), to_location_id: s(r.to_location_id), vehicle_type: s(r.vehicle_type), rate: n(r.rate), tax_pct: n(r.tax_pct), active: active(r) })),
      addons: rows(addons).map((r) => ({
        name: s(r.name),
        property_id: r.property_id ? s(r.property_id) : null,
        rate: n(r.rate),
        rate_foreign: nn(r.rate_foreign),
        tax_pct: n(r.tax_pct),
        active: active(r),
        alias: !!r.merged_into,
        pricing_unit: s(r.pricing_unit),
        min_guests: nn(r.min_guests),
        included_guests: nn(r.included_guests),
        extra_guest_rate: nn(r.extra_guest_rate),
        extra_guest_rate_foreign: nn(r.extra_guest_rate_foreign),
        tiers: tiers(r.tiers),
        tiers_foreign: tiers(r.tiers_foreign),
      })),
      parks: rows(parks).filter(active).map((r) => ({ id: s(r.id), name: s(r.name) })),
      safaris: rows(safaris).map((r) => ({
        park_id: s(r.park_id),
        zone: s(r.zone),
        session: s(r.session),
        vehicle_type: s(r.vehicle_type),
        nationality: nat(r.nationality),
        valid_from: d(r.valid_from),
        valid_to: d(r.valid_to),
        weekday_rate: n(r.weekday_rate),
        weekend_rate: nn(r.weekend_rate),
        naturalist_fee: n(r.naturalist_fee),
        tax_pct: n(r.tax_pct),
        active: active(r),
        book_min_days: nn(r.book_min_days),
        book_max_days: nn(r.book_max_days),
      })),
      tariff: rows(tariff).map((r) => ({
        rate_category_id: s(r.rate_category_id),
        nationality: nat(r.nationality),
        season: ["shoulder", "high", "peak"].includes(s(r.season)) ? s(r.season) : "all",
        valid_from: d(r.valid_from),
        valid_to: d(r.valid_to),
        rate_single: nn(r.rate_single),
        rate_double: n(r.rate_double),
        weekend_rate_double: nn(r.weekend_rate_double),
        meal_plan: mealCode(r.meal_plan) || "AP",
        tax_pct: r.tax_pct === null || r.tax_pct === undefined ? 18 : n(r.tax_pct),
        rates_include_tax: r.rates_include_tax === true, // as the tariff loader reads it
        active: active(r),
      })),
      categories: rows(categories).filter(active).map((r) => ({ id: s(r.id), name: s(r.name), calendar: s(r.calendar) || "pugdundee" })),
      calendar: rows(calendar).map((r) => ({ calendar: s(r.calendar) || "pugdundee", season: s(r.season), date_from: d(r.date_from), date_to: d(r.date_to), active: active(r) })),
    }),
  };
}
