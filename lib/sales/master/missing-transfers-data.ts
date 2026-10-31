// Server side of "Missing transfer rates": reads master data and the saved quotes,
// then lib/sales/master/missing-transfers.ts works out what is missing.
import { createClient } from "@/lib/supabase/server";
import { missingTransferPairs, quoteMissesOf, type MissingPair } from "./missing-transfers";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

// How many saved versions are looked at for transfers that had no rate (newest first).
const VERSIONS = 2000;

export async function loadMissingTransfers(): Promise<{ pairs: MissingPair[]; vehicle: string; error: string | null }> {
  const supabase = await createClient();
  const [props, locs, rates, versions] = await Promise.all([
    supabase.from("sales_properties").select("id, name, park_id, kind, city").eq("active", true),
    supabase.from("sales_locations").select("id, name, type, property_id").eq("active", true),
    supabase.from("sales_transfer_rates").select("from_location_id, to_location_id, vehicle_type, active").eq("active", true),
    // only the two small parts of each version: what had no rate, and the prices typed
    supabase.from("sales_itinerary_versions").select("missing:pricing->missing, manual:plan->manual_prices").order("created_at", { ascending: false }).limit(VERSIONS),
  ]);
  const error = [props, locs, rates].find((r) => r.error)?.error?.message ?? null;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
  const rateRows = rows(rates).map((r) => ({ from_location_id: s(r.from_location_id), to_location_id: s(r.to_location_id), active: r.active !== false, vehicle: s(r.vehicle_type) }));
  // the vehicle most rates are for (Innova): the one the sheet suggests for new rates
  const count = new Map<string, number>();
  for (const r of rateRows) if (r.vehicle) count.set(r.vehicle, (count.get(r.vehicle) ?? 0) + 1);
  const vehicle = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Toyota Innova Crysta";
  const pairs = missingTransferPairs({
    properties: rows(props).map((r) => ({ id: s(r.id), name: s(r.name), park_id: r.park_id ? s(r.park_id) : null, kind: s(r.kind), city: r.city ? s(r.city) : null })),
    locations: rows(locs).map((r) => ({ id: s(r.id), name: s(r.name), type: s(r.type), property_id: r.property_id ? s(r.property_id) : null })),
    rates: rateRows,
    quoteMisses: quoteMissesOf([...rows(versions)].reverse().map((v) => ({ missing: v.missing, manual: v.manual }))),
  });
  return { pairs, vehicle, error };
}
