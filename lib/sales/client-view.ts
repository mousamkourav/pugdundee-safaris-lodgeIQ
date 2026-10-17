// Server-only: assembles the guest-facing itinerary for a share token.
// Uses the service-role client because guests are not signed in; the secret
// token (32 random hex characters) is what grants access to one version.
// Never return internal costs (lodge split, net costs) from here.
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/sales/pricing/dates";
import { MEDIA_BUCKET } from "@/lib/sales/master/types";
import type { Plan } from "@/lib/sales/plan/types";
import { defaultDraft, withEdits } from "@/lib/sales/plan/draft";
import type { Instalment, PriceResult } from "@/lib/sales/pricing/types";

type Row = Record<string, unknown>;

export interface ClientView {
  queryNo: string;
  versionNo: number;
  guestName: string;
  plan: Plan;
  title: string;
  arrival: string | null;
  departure: string | null;
  nights: number;
  guests: number;
  currency: "INR" | "USD";
  fx: number | null;
  total: number; // in quote currency
  perPerson: number; // in quote currency
  payments: (Instalment & { amountInCurrency: number })[];
  validUntil: string;
  heroUrl: string | null;
  lodges: { id: string; name: string; description: string; photos: string[] }[];
  parkNames: Record<string, string>;
  lodgeNames: Record<string, string>;
  sections: {
    about: string;
    inclusions: string[];
    exclusions: string[];
    notes: string[];
    paymentTerms: string;
    cancellation: string[];
  };
  company: { name: string; email: string; phone: string };
  consultant: { name: string; phone: string };
}


export async function loadClientView(token: string): Promise<ClientView | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const db = createAdminClient();

  const { data: v } = await db
    .from("sales_itinerary_versions")
    .select("query_id, version_no, plan, pricing, created_at")
    .eq("share_token", token)
    .maybeSingle();
  if (!v) return null;
  const version = v as { query_id: string; version_no: number; plan: Plan; pricing: PriceResult; created_at: string };
  const plan = version.plan;
  const pricing = version.pricing;

  const { data: q } = await db.from("sales_queries").select("query_no, guest_name, assigned_to, status").eq("id", version.query_id).maybeSingle();
  if (!q) return null;
  const query = q as { query_no: string; guest_name: string; assigned_to: string | null; status: string };
  if (query.status === "draft") return null; // drafts are not ready for guests

  const propertyIds = [...new Set(plan.stops.map((s) => s.property_id))];
  const parkIds = [...new Set(plan.stops.map((s) => s.park_id))];

  const [props, parks, media, brand, blocks, settings, consultant] = await Promise.all([
    db.from("sales_properties").select("id, name, short_desc, long_desc").in("id", propertyIds),
    db.from("sales_parks").select("id, name").in("id", parkIds),
    db.from("sales_media").select("owner_id, storage_path, is_cover, sort").eq("owner_type", "property").in("owner_id", propertyIds).order("sort"),
    db.from("sales_media").select("storage_path, is_cover, sort").eq("owner_type", "brand").is("owner_id", null).order("is_cover", { ascending: false }).order("sort").limit(1),
    db.from("sales_content_blocks").select("kind, body, park_id, property_id, is_default, sort").eq("active", true).not("kind", "like", "day_%").order("sort"),
    db.from("sales_settings").select("data").eq("id", 1).maybeSingle(),
    query.assigned_to ? db.from("profiles").select("full_name, phone").eq("id", query.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const bucket = db.storage.from(MEDIA_BUCKET);
  const url = (p: string) => bucket.getPublicUrl(p).data.publicUrl;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

  const mediaRows = rows(media) as { owner_id: string; storage_path: string; is_cover: boolean; sort: number }[];
  const photosOf = (id: string) =>
    mediaRows
      .filter((m) => m.owner_id === id)
      .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort - b.sort)
      .slice(0, 3)
      .map((m) => url(m.storage_path));

  const propRows = rows(props);
  const lodges = propertyIds.map((id) => {
    const p = propRows.find((r) => r.id === id) ?? {};
    return { id, name: String(p.name ?? ""), description: String(p.long_desc || p.short_desc || ""), photos: photosOf(id) };
  });
  const lodgeNames = Object.fromEntries(lodges.map((l) => [l.id, l.name]));
  const parkNames = Object.fromEntries(rows(parks).map((r) => [String(r.id), String(r.name)]));

  const brandRow = rows(brand)[0] as { storage_path: string } | undefined;
  const heroUrl = brandRow ? url(brandRow.storage_path) : lodges.find((l) => l.photos.length)?.photos[0] ?? null;

  const blockRows = rows(blocks) as { kind: string; body: string; park_id: string | null; property_id: string | null; is_default: boolean }[];
  const s = ((settings.data as { data?: Row } | null)?.data ?? {}) as Row;
  const company = (s.company ?? {}) as Row;
  const nights = plan.stops.reduce((t, x) => t + x.nights, 0);
  const slabs = (Array.isArray(s.cancellation_slabs) ? s.cancellation_slabs : []) as { min_days?: number; max_days?: number | null; pct?: number }[];

  // Same text as the builder's Final draft step, including the sales member's edits.
  const sections = withEdits(
    defaultDraft(plan, {
      parkNames,
      lodgeNames,
      blocks: blockRows,
      cancellationSlabs: slabs.map((c) => ({ min_days: Number(c.min_days ?? 0), max_days: c.max_days == null ? null : Number(c.max_days), pct: Number(c.pct ?? 0) })),
    }),
    plan.draft
  );

  const fx = pricing.fx ?? null;
  const usd = pricing.currency === "USD" && !!fx;
  const conv = (n: number) => (usd ? Math.round((n / fx!) * 100) / 100 : n);
  const validity = Number(s.quote_validity_days ?? 15) || 15;

  const consultantRow = (consultant.data ?? null) as { full_name?: string; phone?: string } | null;

  return {
    queryNo: query.query_no,
    versionNo: version.version_no,
    guestName: query.guest_name,
    plan,
    title: sections.title,
    arrival: pricing.arrival,
    departure: pricing.departure,
    nights,
    guests: pricing.guests,
    currency: usd ? "USD" : "INR",
    fx,
    total: conv(pricing.totals.grand),
    perPerson: conv(pricing.perPerson),
    payments: pricing.payments.map((p) => ({ ...p, amountInCurrency: conv(p.amount) })),
    validUntil: addDays(version.created_at.slice(0, 10), validity),
    heroUrl,
    lodges,
    parkNames,
    lodgeNames,
    sections: {
      about: sections.about,
      inclusions: sections.inclusions,
      exclusions: sections.exclusions,
      notes: sections.notes,
      paymentTerms: sections.paymentTerms,
      cancellation: sections.cancellation,
    },
    company: { name: String(company.name || "Pugdundee Safaris"), email: String(company.email || ""), phone: String(company.phone || "") },
    consultant: { name: String(consultantRow?.full_name || ""), phone: String(consultantRow?.phone || "") },
  };
}
