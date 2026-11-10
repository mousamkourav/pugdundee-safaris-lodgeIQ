// Client links (10 Nov 2026): /quote/jj-lheureux-x7k2m9/1, /quote/jj-lheureux-x7k2m9/2.
// The key is the guest's name words + 6 random characters, made once per quote in the database
// (supabase/sales_quote_links.sql); the number is the version. Old links (/i/...) keep working.

// name words, then 6 characters from the no-look-alike alphabet (no l, 1, o, 0)
export const isQuoteKey = (s: string) => s.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-km-np-z2-9]{6}$/.test(s);
export const isVersionNo = (s: string) => /^[1-9]\d{0,2}$/.test(s);

export const quotePath = (key: string, versionNo: number) => `/quote/${key}/${versionNo}`;

// The link of one version: the new kind when the quote has its key, else the old one
export function clientLinkPath(key: string | null | undefined, v: { version_no: number; share_slug?: string | null; share_token?: string | null }): string {
  if (key && isQuoteKey(key)) return quotePath(key, v.version_no);
  return `/i/${v.share_slug ?? v.share_token ?? ""}`;
}
