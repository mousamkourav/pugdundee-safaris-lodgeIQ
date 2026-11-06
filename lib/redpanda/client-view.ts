// The Red Panda guest page's data, by the version's unguessable link (/i/<slug> or the old
// 32-character token). Service role (the guest has no account), so it returns ONLY what the guest
// may see: never costs, markup, discount, the adjustment or its reason, a typed rate or notes.
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isShareSlug, isShareToken } from "@/lib/sales/share-slug";
import { MEDIA_BUCKET } from "@/lib/sales/master/types";
import { DIRECT_CONTACTS_DEFAULT, WHATSAPP_DEFAULT, whatsappHref } from "@/lib/sales/master/settings";
import { contactsFor, type Contact } from "@/lib/sales/client-view";
import { guestBreakup, priceRedPanda } from "./pricing";
import { readSettings, sanitizeRpPlan } from "./plan";
import { rpGuestContent, type RpGuestContent } from "./content";
import type { RpPrice } from "./types";

type Row = Record<string, unknown>;

export interface RpClientView {
  queryNo: string;
  versionNo: number;
  guestName: string;
  content: RpGuestContent;
  total: number;
  perPerson: number;
  breakup: { label: string; amount: number }[];
  payments: { label: string; due: string | null; amount: number; note?: string }[];
  quotedOn: string;
  validUntil: string;
  cover: string | null;
  photos: { url: string; caption: string | null }[];
  cancellation: string[];
  consultant: Contact;
  emergency: Contact | null;
  directContacts: string[];
  whatsapp: string;
  company: { name: string; email: string; phone: string };
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function cancellationLines(slabs: { min_days: number; max_days: number | null; pct: number }[]): string[] {
  return slabs
    .slice()
    .sort((a, b) => a.min_days - b.min_days)
    .map((c) =>
      c.max_days == null
        ? `${c.min_days} days or more before arrival: ${c.pct}% of the total`
        : c.min_days === 0
          ? `${c.max_days} days or less before arrival: ${c.pct}% of the total`
          : `${c.min_days} to ${c.max_days} days before arrival: ${c.pct}% of the total`
    );
}

export const loadRpClientView = cache(async (link: string): Promise<RpClientView | null> => {
  const byToken = isShareToken(link);
  if (!byToken && !isShareSlug(link)) return null;
  const db = createAdminClient();
  const { data: v } = await db
    .from("sales_itinerary_versions")
    .select("query_id, version_no, plan, pricing, created_at")
    .eq(byToken ? "share_token" : "share_slug", link)
    .maybeSingle();
  if (!v || (v as { plan?: { kind?: string } }).plan?.kind !== "red_panda") return null;
  const version = v as { query_id: string; version_no: number; plan: unknown; pricing: RpPrice; created_at: string };
  const { data: q } = await db.from("sales_queries").select("query_no, guest_name, assigned_to, status, query_type").eq("id", version.query_id).is("deleted_at", null).maybeSingle();
  const query = q as { query_no: string; guest_name: string; assigned_to: string | null; status: string; query_type?: string } | null;
  if (!query || query.status === "draft") return null;

  const [settings, images, salesSettings, consultant, blocks] = await Promise.all([
    db.from("rp_settings").select("data").eq("id", 1).maybeSingle(),
    db.from("rp_images").select("storage_path, caption, is_cover, sort").order("is_cover", { ascending: false }).order("sort").limit(30),
    db.from("sales_settings").select("data").eq("id", 1).maybeSingle(),
    query.assigned_to ? db.from("profiles").select("full_name, phone, extra").eq("id", query.assigned_to).maybeSingle() : Promise.resolve({ data: null }),
    db.from("sales_content_blocks").select("kind, body, park_id, property_id").eq("active", true).eq("kind", "cancellation_terms").is("park_id", null).is("property_id", null).order("sort"),
  ]);
  const rp = readSettings((settings.data as { data?: unknown } | null)?.data);
  const plan = sanitizeRpPlan(version.plan);
  // the saved price (as quoted); an older row without it is priced again from the saved plan only
  const price: RpPrice = version.pricing && version.pricing.totals ? version.pricing : priceRedPanda(plan, { tariff: [], supplements: [], settings: rp, hotel: null });
  const bucket = db.storage.from(MEDIA_BUCKET);
  const imgs = ((images.data ?? []) as { storage_path: string; caption: string | null; is_cover: boolean }[]).map((m) => ({
    url: bucket.getPublicUrl(m.storage_path).data.publicUrl,
    caption: m.caption,
    is_cover: m.is_cover,
  }));
  const cover = imgs.find((m) => m.is_cover)?.url ?? imgs[0]?.url ?? null;
  const s = ((salesSettings.data as { data?: Row } | null)?.data ?? {}) as Row;
  const company = (s.company ?? {}) as Row;
  const guestPage = (s.guest_page ?? {}) as Row;
  const slabs = (Array.isArray(s.cancellation_slabs) ? s.cancellation_slabs : []) as Row[];
  const blockLines = ((blocks.data ?? []) as { body: string }[]).flatMap((b) => String(b.body ?? "").split(/\r?\n/)).map((x) => x.replace(/^[-*\u2022]\s*/, "").trim()).filter(Boolean);
  const contacts = await contactsFor(db, query.assigned_to, (consultant.data ?? null) as { full_name?: string; phone?: string; extra?: Record<string, unknown> } | null);
  const validity = Number(s.quote_validity_days ?? 15) || 15;
  const listed = String(guestPage.direct_contacts ?? "").split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean).slice(0, 12);

  return {
    queryNo: query.query_no,
    versionNo: version.version_no,
    guestName: query.guest_name,
    content: rpGuestContent(plan, price, rp),
    total: price.totals.grand,
    perPerson: price.perPerson,
    breakup: guestBreakup(price),
    payments: (price.payments ?? []).map((p) => ({ label: p.label, due: p.due, amount: p.amount, note: p.note })),
    quotedOn: version.created_at.slice(0, 10),
    validUntil: addDays(version.created_at.slice(0, 10), validity),
    cover,
    photos: imgs.filter((m) => m.url !== cover).map((m) => ({ url: m.url, caption: m.caption })),
    cancellation: blockLines.length
      ? blockLines
      : cancellationLines(slabs.map((c) => ({ min_days: Number(c.min_days ?? 0), max_days: c.max_days == null ? null : Number(c.max_days), pct: Number(c.pct ?? 0) }))),
    consultant: contacts.consultant,
    emergency: contacts.emergency,
    directContacts: listed.length ? listed : DIRECT_CONTACTS_DEFAULT,
    whatsapp: whatsappHref(guestPage.whatsapp_number ?? WHATSAPP_DEFAULT.number, guestPage.whatsapp_text ?? WHATSAPP_DEFAULT.text, guestPage.whatsapp_link ?? WHATSAPP_DEFAULT.link),
    company: { name: String(company.name || "Pugdundee Safaris"), email: String(company.email || ""), phone: String(company.phone || "") },
  };
});
