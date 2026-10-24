// Server-only: assembles the guest-facing itinerary for a share token.
// Uses the service-role client because guests are not signed in; the secret
// token (32 random hex characters) is what grants access to one version.
// Never return internal costs (lodge split, net costs) from here.
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/sales/pricing/dates";
import { MEDIA_BUCKET } from "@/lib/sales/master/types";
import type { Plan } from "@/lib/sales/plan/types";
import { defaultDraft, withEdits } from "@/lib/sales/plan/draft";
import { detailedBreakdown, priceBreakdown } from "@/lib/sales/pricing/breakdown";
import { isShareSlug, isShareToken } from "@/lib/sales/share-slug";
import { cache } from "react";
import type { Instalment, ParkClosure, PriceResult } from "@/lib/sales/pricing/types";

export interface Contact {
  name: string;
  phone: string;
  email: string;
}

type Row = Record<string, unknown>;

export interface ClientView {
  queryNo: string;
  versionNo: number;
  guestName: string;
  plan: Plan;
  title: string; // cover headline
  routeLine: string; // "Satpura, Pench, Kanha, Bandhavgarh & Tadoba"
  arrival: string | null;
  departure: string | null;
  nights: number;
  guests: number;
  currency: "INR" | "USD" | "EUR" | "GBP" | "AUD";
  fx: number | null;
  total: number; // in quote currency
  perPerson: number; // in quote currency
  payments: (Instalment & { amountInCurrency: number })[];
  validUntil: string;
  quotedOn: string; // when this version was prepared
  // The total is always shown; the breakup is none, by service ("summary") or line by line ("detailed").
  show: { prices: boolean; breakup: "none" | "summary" | "detailed" };
  breakup: { label: string; amount: number; gst?: boolean }[]; // in quote currency
  detail: { date: string | null; label: string; quantity: number; net: number; gstPct: number | null; gst: number; amount: number }[]; // in quote currency
  dateless: boolean;
  stays: { property_id: string; room: string; meal: string; nights: number }[]; // room type per lodge
  // Know about the parks: the short text, the main image, the wildlife photos and the "Read more" link
  parks: { id: string; name: string; description: string; hero: string | null; photos: string[]; website: string | null }[];
  driveHours: Record<string, number>; // "from|to" location ids -> hours
  heroUrl: string | null;
  lodges: { id: string; name: string; description: string; photos: string[]; website: string | null }[];
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
  consultant: Contact;
  emergency: Contact | null;
}


// One load per request, shared by the page and its title (generateMetadata).
export const loadClientView = cache(loadClientViewUncached);

async function loadClientViewUncached(link: string): Promise<ClientView | null> {
  // Old links: the 32-character token. New links: the personalised slug.
  const byToken = isShareToken(link);
  if (!byToken && !isShareSlug(link)) return null;
  const db = createAdminClient();

  const { data: v } = await db
    .from("sales_itinerary_versions")
    .select("query_id, version_no, plan, pricing, created_at")
    .eq(byToken ? "share_token" : "share_slug", link)
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

  const roomIds = [...new Set(plan.stops.map((s) => s.room_category_id).filter(Boolean))];
  const locIds = [...new Set(plan.days.flatMap((d) => (d.transfer ? [d.transfer.from_location_id, d.transfer.to_location_id] : [])))];
  const [props, parks, media, brand, blocks, settings, consultant, rooms, parkMedia, closures, roads] = await Promise.all([
    db.from("sales_properties").select("id, name, short_desc, long_desc, website").in("id", propertyIds),
    db.from("sales_parks").select("*").in("id", parkIds), // "*": the website column is new (sales_v3_flights_parks.sql)
    db.from("sales_media").select("owner_id, storage_path, is_cover, sort").eq("owner_type", "property").in("owner_id", propertyIds).order("sort"),
    db.from("sales_media").select("storage_path, is_cover, sort").eq("owner_type", "brand").is("owner_id", null).order("is_cover", { ascending: false }).order("sort").limit(1),
    db.from("sales_content_blocks").select("kind, body, park_id, property_id, is_default, sort").eq("active", true).not("kind", "like", "day_%").order("sort"),
    db.from("sales_settings").select("data").eq("id", 1).maybeSingle(),
    query.assigned_to ? db.from("profiles").select("full_name, phone, extra").eq("id", query.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    roomIds.length ? db.from("sales_room_categories").select("id, name").in("id", roomIds) : Promise.resolve({ data: [] }),
    db.from("sales_media").select("owner_id, storage_path, is_cover, sort").eq("owner_type", "park").in("owner_id", parkIds).order("sort"),
    db.from("sales_park_closures").select("*").in("park_id", parkIds),
    locIds.length ? db.from("sales_transfer_rates").select("from_location_id, to_location_id, drive_hours").eq("active", true).not("drive_hours", "is", null).in("from_location_id", locIds) : Promise.resolve({ data: [] }),
  ]);

  const bucket = db.storage.from(MEDIA_BUCKET);
  const url = (p: string) => bucket.getPublicUrl(p).data.publicUrl;
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

  const mediaRows = rows(media) as { owner_id: string; storage_path: string; is_cover: boolean; sort: number }[];
  const photosOf = (id: string) =>
    mediaRows
      .filter((m) => m.owner_id === id)
      .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort - b.sort)
      .slice(0, 10)
      .map((m) => url(m.storage_path));

  const parkMediaRows = rows(parkMedia) as { owner_id: string; storage_path: string; is_cover: boolean; sort: number }[];
  const parkRows = rows(parks);
  const parkList = parkIds.map((id) => {
    const p = parkRows.find((r) => r.id === id) ?? {};
    const media = parkMediaRows.filter((m) => m.owner_id === id).sort((a, b) => a.sort - b.sort);
    const cover = media.find((m) => m.is_cover);
    const site = String(p.website ?? "").trim();
    return {
      id,
      name: String(p.name ?? ""),
      // the short description (40-50 words) is made for this; the long one only if there is no short one
      description: String(p.short_desc || p.long_desc || "").trim(),
      hero: cover ? url(cover.storage_path) : null,
      photos: media.filter((m) => !m.is_cover).slice(0, 12).map((m) => url(m.storage_path)),
      website: site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null,
    };
  });
  const roomName = Object.fromEntries(rows(rooms).map((r) => [String(r.id), String(r.name)]));
  const MEAL: Record<string, string> = { AP: "All meals", MAP: "Breakfast and dinner", CP: "Breakfast", EP: "Room only" };
  const stays = plan.stops.map((st) => ({ property_id: st.property_id, room: roomName[st.room_category_id] ?? "", meal: MEAL[st.meal_plan] ?? st.meal_plan, nights: st.nights }));
  const driveHours: Record<string, number> = {};
  for (const r of rows(roads)) {
    const h = Number(r.drive_hours);
    if (!h) continue;
    driveHours[`${r.from_location_id}|${r.to_location_id}`] ??= h;
    driveHours[`${r.to_location_id}|${r.from_location_id}`] ??= h;
  }
  const closureRows = rows(closures).map(
    (r): ParkClosure => ({
      park_id: String(r.park_id),
      zone: String(r.zone) as ParkClosure["zone"],
      closure_type: String(r.closure_type) as ParkClosure["closure_type"],
      weekday: r.weekday == null ? null : Number(r.weekday),
      session: String(r.session) as ParkClosure["session"],
      date_from: r.date_from ? String(r.date_from).slice(0, 10) : null,
      date_to: r.date_to ? String(r.date_to).slice(0, 10) : null,
      label: r.label ? String(r.label) : null,
    })
  );

  const propRows = rows(props);
  const lodges = propertyIds.map((id) => {
    const p = propRows.find((r) => r.id === id) ?? {};
    const site = String(p.website ?? "").trim();
    return {
      id,
      name: String(p.name ?? ""),
      description: String(p.long_desc || p.short_desc || ""),
      photos: photosOf(id),
      website: site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null,
    };
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
      closures: closureRows,
      today: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
      cancellationSlabs: slabs.map((c) => ({ min_days: Number(c.min_days ?? 0), max_days: c.max_days == null ? null : Number(c.max_days), pct: Number(c.pct ?? 0) })),
    }),
    plan.draft
  );

  // Any quote currency with a rate (older code only converted USD).
  const fx = pricing.fx ?? null;
  const foreign = pricing.currency !== "INR" && !!fx;
  const conv = (n: number) => (foreign ? Math.round((n / fx!) * 100) / 100 : n);
  const validity = Number(s.quote_validity_days ?? 15) || 15;

  const consultantRow = (consultant.data ?? null) as { full_name?: string; phone?: string; extra?: Record<string, unknown> } | null;
  const contacts = await contactsFor(db, query.assigned_to, consultantRow);

  return {
    queryNo: query.query_no,
    versionNo: version.version_no,
    guestName: query.guest_name,
    plan,
    title: sections.title,
    routeLine: sections.routeLine,
    // the whole trip, including nights in a city before or after the lodges
    arrival: plan.days[0]?.date ?? pricing.arrival,
    departure: plan.days[plan.days.length - 1]?.date ?? pricing.departure,
    nights,
    guests: pricing.guests,
    currency: foreign ? pricing.currency : "INR",
    fx,
    total: conv(pricing.totals.grand),
    perPerson: conv(pricing.perPerson),
    payments: pricing.payments.map((p) => ({ ...p, amountInCurrency: conv(p.amount) })),
    validUntil: addDays(version.created_at.slice(0, 10), validity),
    quotedOn: version.created_at.slice(0, 10),
    show: { prices: true, breakup: plan.client?.breakup ?? (plan.client?.show_breakup ? "summary" : "none") },
    breakup: priceBreakdown(pricing).rows.map((r) => ({ label: r.label, amount: conv(r.amount), ...(r.key === "gst" ? { gst: true } : {}) })),
    detail: pricing.lines
      ? detailedBreakdown(pricing).rows.map((r) => ({ date: r.date, label: r.label, quantity: r.quantity, net: conv(r.net), gstPct: r.gstPct, gst: conv(r.gst), amount: conv(r.amount) }))
      : [],
    dateless: !!plan.dateless,
    stays,
    parks: parkList,
    driveHours,
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
    consultant: contacts.consultant,
    emergency: contacts.emergency,
  };
}

// The safari consultant (who the query is assigned to) and the emergency contact:
// the member they chose in Sales > Team, else another active sales member.
async function contactsFor(
  db: ReturnType<typeof createAdminClient>,
  consultantId: string | null,
  consultantRow: { full_name?: string; phone?: string; extra?: Record<string, unknown> } | null
): Promise<{ consultant: Contact; emergency: Contact | null }> {
  const emailOf = async (id: string) => {
    try {
      const { data } = await db.auth.admin.getUserById(id);
      return data?.user?.email ?? "";
    } catch {
      return "";
    }
  };
  const consultant: Contact = {
    name: String(consultantRow?.full_name || ""),
    phone: String(consultantRow?.phone || ""),
    email: consultantId ? await emailOf(consultantId) : "",
  };
  const chosen = typeof consultantRow?.extra?.sales_emergency_contact_id === "string" ? (consultantRow.extra.sales_emergency_contact_id as string) : null;
  const { data: team } = await db.from("profiles").select("id, full_name, phone, status").in("role", ["sales_member", "sales_admin"]);
  const members = ((team ?? []) as { id: string; full_name: string | null; phone: string | null; status: string | null }[]).filter((m) => m.status !== "disabled" && m.id !== consultantId);
  const pick = members.find((m) => m.id === chosen) ?? members.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""))[0];
  if (!pick) return { consultant, emergency: null };
  return { consultant, emergency: { name: pick.full_name || "", phone: pick.phone || "", email: await emailOf(pick.id) } };
}
