// Server-side: everything the itinerary builder needs, as plain data.
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { MASTER_TAG, MASTER_TTL } from "@/lib/sales/master/cache";
import { timed } from "@/lib/timing";
import { loadPricingData } from "@/lib/sales/pricing/load";
import type { BuilderContext } from "./types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const sn = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const n = (v: unknown, f = 0) => (v === null || v === undefined || v === "" ? f : Number(v));

// Master data changes rarely but is read by every builder page and action: kept for a few
// minutes (MASTER_TTL) and dropped as soon as anything in Master data is saved
// (revalidateMasterData). Read with the service key, so only after checking the user is in
// Sales; anyone else (and any failure) reads it the normal way, through RLS.
const cachedContext = unstable_cache(
  async () => {
    const r = await readContext(createAdminClient());
    if (r.error) throw new Error(r.error); // an error is never cached
    console.log(`[timing] builder context read from the database: ${Math.round(JSON.stringify(r.ctx).length / 1024)}KB`);
    return r.ctx;
  },
  ["sales-builder-context-v1"],
  { revalidate: MASTER_TTL, tags: [MASTER_TAG] }
);

export async function loadBuilderContext(): Promise<{ ctx: BuilderContext; error: string | null }> {
  return timed("loadBuilderContext", async () => {
    const cu = await getCurrentUser();
    if (cu?.user && isSalesUser(cu.profile?.role)) {
      try {
        return { ctx: await cachedContext(), error: null };
      } catch {
        // fall back to a direct read below
      }
    }
    return readContext(await createClient());
  });
}

async function readContext(supabase: SupabaseClient): Promise<{ ctx: BuilderContext; error: string | null }> {
  const [{ data: pricing, error: pricingError }, props, locs, rooms, tpl, content, settings, flights, rules, glossary] = await Promise.all([
    loadPricingData(supabase),
    supabase.from("sales_properties").select("*").eq("active", true),
    supabase.from("sales_locations").select("id, name, type, property_id, code").eq("active", true).order("name"),
    supabase.from("sales_room_categories").select("id, property_id, name, sort").eq("active", true),
    supabase
      .from("sales_content_blocks")
      .select("kind, title, body, park_id, property_id, is_default")
      .eq("active", true)
      .like("kind", "day_%")
      .order("sort"),
    supabase
      .from("sales_content_blocks")
      .select("kind, body, park_id, property_id, is_default")
      .eq("active", true)
      .not("kind", "like", "day_%")
      .order("sort"),
    supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle(),
    // Master data > Flight routes (the table may not exist yet: then none)
    supabase.from("sales_flight_routes").select("id, from_city, to_city, airline, flight_no, depart_time, arrive_time, fare, cabin").eq("active", true).order("from_city").order("to_city").order("sort"),
    // what the reader was taught: approved rules, and short glossary terms (tables may not exist yet: then none)
    supabase.from("sales_reader_rules").select("phrase, meaning").eq("status", "approved").limit(500),
    supabase.from("sales_glossary").select("term, meaning").eq("active", true).limit(300),
  ]);
  const err = pricingError ?? [props, locs, rooms, tpl, content, settings].find((r) => r.error)?.error?.message ?? null;
  const slabs = ((settings.data as { data?: { cancellation_slabs?: unknown } } | null)?.data?.cancellation_slabs ?? []) as Row[];
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
        city: sn(r.city),
      })),
      locations: rows(locs).map((r) => ({ id: s(r.id), name: s(r.name), type: s(r.type), property_id: sn(r.property_id), code: sn(r.code) })),
      rooms: rows(rooms).map((r) => ({ id: s(r.id), property_id: s(r.property_id), name: s(r.name), sort: n(r.sort) })),
      templates: rows(tpl).map((r) => ({
        kind: s(r.kind),
        title: s(r.title),
        body: s(r.body),
        park_id: sn(r.park_id),
        property_id: sn(r.property_id),
        is_default: !!r.is_default,
      })),
      content: rows(content).map((r) => ({
        kind: s(r.kind),
        body: s(r.body),
        park_id: sn(r.park_id),
        property_id: sn(r.property_id),
        is_default: !!r.is_default,
      })),
      flightRoutes: flights.error
        ? []
        : rows(flights).map((r) => ({
            id: s(r.id),
            from_city: s(r.from_city),
            to_city: s(r.to_city),
            airline: s(r.airline),
            flight_no: s(r.flight_no),
            depart_time: s(r.depart_time).slice(0, 5),
            arrive_time: s(r.arrive_time).slice(0, 5),
            fare: n(r.fare, 15000),
            cabin: s(r.cabin) || "Economy",
          })),
      readerRules: [
        ...(rules.error ? [] : rows(rules).map((r) => ({ phrase: s(r.phrase), meaning: s(r.meaning) }))),
        // a glossary meaning the reader can read in place of the term ("THH" = "Tree House Hideaway (Bandhavgarh)"),
        // not an explanation ("core zone, where the tigers are")
        ...(glossary.error ? [] : rows(glossary).map((r) => ({ phrase: s(r.term), meaning: s(r.meaning) })).filter((g) => g.meaning.length <= 40 && !/[,;:=]/.test(g.meaning))),
      ].filter((r) => r.phrase && r.meaning),
      cancellation: (Array.isArray(slabs) ? slabs : []).map((c) => ({
        min_days: n(c.min_days),
        max_days: c.max_days === null || c.max_days === undefined || c.max_days === "" ? null : n(c.max_days),
        pct: n(c.pct),
      })),
    },
  };
}

// Today's date in India, as YYYY-MM-DD.
export function todayIST() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}
