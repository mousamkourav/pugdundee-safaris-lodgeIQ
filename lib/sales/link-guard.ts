// Client links are opened without signing in, so they are protected by being impossible to guess
// (lib/sales/quote-link.ts). This adds two locks (10 Nov 2026):
//   - many wrong links from one device in 15 minutes: that device is blocked for a while
//   - a quote's links turned off by Sales: every link of it says it is no longer active
// The device is kept only as a salted hash (never the address). Anything failing here (the table
// not created yet) lets the page work as before: the links stay unguessable either way.
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

const WINDOW_MIN = 15;
const MAX_MISSES = 20;

export async function deviceKey(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const salt = process.env.LINK_GUARD_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "lodgeiq";
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 32);
}

export async function isBlocked(who: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { count, error } = await createAdminClient().from("sales_link_misses").select("id", { count: "exact", head: true }).eq("who", who).gte("at", since);
    return !error && (count ?? 0) >= MAX_MISSES;
  } catch {
    return false;
  }
}

export async function recordMiss(who: string): Promise<void> {
  try {
    const db = createAdminClient();
    await db.from("sales_link_misses").insert({ who });
    // now and then, forget misses older than a day
    if (Math.random() < 0.05) await db.from("sales_link_misses").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
  } catch {
    /* the page still works */
  }
}

// Is this quote's client link turned off? (query id)
export async function linkOff(queryId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().from("sales_queries").select("share_disabled_at").eq("id", queryId).maybeSingle();
    return !error && !!(data as { share_disabled_at?: string | null } | null)?.share_disabled_at;
  } catch {
    return false;
  }
}

// The quote behind an old link (/i/<slug> or /i/<token>)
export async function queryOfOldLink(link: string, byToken: boolean): Promise<string | null> {
  try {
    const { data } = await createAdminClient().from("sales_itinerary_versions").select("query_id").eq(byToken ? "share_token" : "share_slug", link).maybeSingle();
    return (data as { query_id?: string } | null)?.query_id ?? null;
  } catch {
    return null;
  }
}

// /quote/<key>/<n> -> the version's own link (its slug or token), or why not
export async function resolveQuoteLink(key: string, versionNo: number): Promise<{ link: string } | { off: true } | null> {
  const db = createAdminClient();
  const { data: q, error } = await db.from("sales_queries").select("id, share_disabled_at").eq("share_key", key).is("deleted_at", null).maybeSingle();
  if (error || !q) return null;
  const row = q as { id: string; share_disabled_at: string | null };
  if (row.share_disabled_at) return { off: true };
  const { data: v } = await db.from("sales_itinerary_versions").select("share_slug, share_token").eq("query_id", row.id).eq("version_no", versionNo).maybeSingle();
  const ver = v as { share_slug: string | null; share_token: string | null } | null;
  const link = ver?.share_slug ?? ver?.share_token ?? null;
  return link ? { link } : null;
}
