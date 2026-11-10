import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClientItineraryPage, { generateMetadata as itineraryMetadata } from "@/app/i/[token]/page";
import { isQuoteKey, isVersionNo } from "@/lib/sales/quote-link";
import { deviceKey, isBlocked, recordMiss, resolveQuoteLink } from "@/lib/sales/link-guard";
import { LinkMessage } from "@/components/sales/link-message";

// The client link: /quote/jj-lheureux-x7k2m9/2 = version 2 of that quote (10 Nov 2026).
// Public (no sign-in), like /i/...: the key's 6 random characters keep it unguessable; a device
// trying many wrong links is blocked for a while; a quote's links can be turned off by Sales.
// The page itself is the same as the old link's (app/i/[token]).
type Params = { params: Promise<{ key: string; v: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { key, v } = await params;
  const hidden = { title: "Your safari itinerary - Pugdundee Safaris", robots: { index: false, follow: false } };
  if (!isQuoteKey(key) || !isVersionNo(v)) return hidden;
  const r = await resolveQuoteLink(key, Number(v)).catch(() => null);
  if (!r || "off" in r) return hidden;
  return itineraryMetadata({ params: Promise.resolve({ token: r.link }) });
}

export default async function QuoteLinkPage({ params }: Params) {
  const { key, v } = await params;
  const who = await deviceKey();
  if (await isBlocked(who)) return <LinkMessage kind="blocked" />;
  const r = isQuoteKey(key) && isVersionNo(v) ? await resolveQuoteLink(key, Number(v)).catch(() => null) : null;
  if (!r) {
    await recordMiss(who);
    notFound();
  }
  if ("off" in r) return <LinkMessage kind="off" />;
  return <ClientItineraryPage params={Promise.resolve({ token: r.link })} />;
}
