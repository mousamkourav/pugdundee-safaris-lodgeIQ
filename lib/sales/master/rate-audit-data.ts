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

export async function loadRateAudit(): Promise<{ rows: AuditRow[]; error: string | null }> {
  const supabase = await createClient();
  const all = (table: string) => supabase.from(table).select("*");
  const [props, locs, rooms, rates, transfers, addons] = await Promise.all([
    all("sales_properties"),
    all("sales_locations"),
    all("sales_room_categories"),
    all("sales_room_rates"),
    all("sales_transfer_rates"),
    all("sales_addons"),
  ]);
  const error = [props, locs, rooms, rates, transfers, addons].find((r) => r.error)?.error?.message ?? null;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
  const active = (r: Row) => r.active !== false;
  return {
    error,
    rows: auditRates({
      properties: rows(props).filter(active).map((r) => ({ id: s(r.id), name: s(r.name), kind: s(r.kind) })),
      locations: rows(locs).filter(active).map((r) => ({ id: s(r.id), name: s(r.name), type: s(r.type), property_id: r.property_id ? s(r.property_id) : null })),
      rooms: rows(rooms).filter(active).map((r) => ({ id: s(r.id), property_id: s(r.property_id), name: s(r.name) })),
      roomRates: rows(rates).map((r) => ({
        room_category_id: s(r.room_category_id),
        valid_from: d(r.valid_from),
        valid_to: d(r.valid_to),
        meal_plan: mealCode(r.meal_plan),
        rate_single: nn(r.rate_single),
        rate_double: n(r.rate_double),
        tax_pct: n(r.tax_pct),
        rates_include_tax: r.rates_include_tax !== false, // as the pricing engine reads it
        nationality: ["indian", "foreign"].includes(s(r.nationality)) ? s(r.nationality) : "all",
        active: active(r),
      })),
      transfers: rows(transfers).map((r) => ({ from_location_id: s(r.from_location_id), to_location_id: s(r.to_location_id), vehicle_type: s(r.vehicle_type), rate: n(r.rate), tax_pct: n(r.tax_pct), active: active(r) })),
      addons: rows(addons).map((r) => ({ name: s(r.name), property_id: r.property_id ? s(r.property_id) : null, rate: n(r.rate), rate_foreign: nn(r.rate_foreign), tax_pct: n(r.tax_pct), active: active(r), alias: !!r.merged_into })),
    }),
  };
}
