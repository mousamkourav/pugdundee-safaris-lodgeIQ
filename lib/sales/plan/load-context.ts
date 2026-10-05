// Server-side: everything the itinerary builder needs, as plain data.
import { createClient } from "@/lib/supabase/server";
import { loadPricingData } from "@/lib/sales/pricing/load";
import type { BuilderContext } from "./types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const sn = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const n = (v: unknown, f = 0) => (v === null || v === undefined || v === "" ? f : Number(v));

export async function loadBuilderContext(): Promise<{ ctx: BuilderContext; error: string | null }> {
  const supabase = await createClient();
  const [{ data: pricing, error: pricingError }, props, locs, rooms, tpl] = await Promise.all([
    loadPricingData(),
    supabase.from("sales_properties").select("id, name, park_id, kind, fallback_priority, sort").eq("active", true),
    supabase.from("sales_locations").select("id, name, type, property_id").eq("active", true).order("name"),
    supabase.from("sales_room_categories").select("id, property_id, name, sort").eq("active", true),
    supabase
      .from("sales_content_blocks")
      .select("kind, title, body, park_id, property_id, is_default")
      .eq("active", true)
      .like("kind", "day_%")
      .order("sort"),
  ]);
  const err = pricingError ?? [props, locs, rooms, tpl].find((r) => r.error)?.error?.message ?? null;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

  return {
    error: err,
    ctx: {
      pricing,
      properties: rows(props).map((r) => ({
        id: s(r.id),
        name: s(r.name),
        park_id: sn(r.park_id),
        kind: s(r.kind),
        fallback_priority: n(r.fallback_priority, 100),
        sort: n(r.sort),
      })),
      locations: rows(locs).map((r) => ({ id: s(r.id), name: s(r.name), type: s(r.type), property_id: sn(r.property_id) })),
      rooms: rows(rooms).map((r) => ({ id: s(r.id), property_id: s(r.property_id), name: s(r.name), sort: n(r.sort) })),
      templates: rows(tpl).map((r) => ({
        kind: s(r.kind),
        title: s(r.title),
        body: s(r.body),
        park_id: sn(r.park_id),
        property_id: sn(r.property_id),
        is_default: !!r.is_default,
      })),
    },
  };
}

// Today's date in India, as YYYY-MM-DD.
export function todayIST() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
