// The price as the guest can see it: one row per kind of service (before GST),
// discounts, then GST on its own line. Works for any saved quote, because every
// price line records its own GST. Markup is spread over the service rows in
// proportion, so it is never shown as a separate charge.
import type { PriceLine, PriceResult } from "./types";

export interface BreakdownRow {
  key: "accommodation" | "hotels" | "safaris" | "naturalists" | "transfers" | "flights" | "extras" | "discount" | "adjustment" | "gst";
  label: string;
  amount: number;
}

const SERVICE_ROWS: { key: BreakdownRow["key"]; label: string; match: (l: PriceLine) => boolean }[] = [
  { key: "accommodation", label: "Accommodation", match: (l) => l.kind === "room" },
  { key: "hotels", label: "City hotels", match: (l) => l.kind === "addon" && l.group === "hotel" },
  { key: "safaris", label: "Safaris", match: (l) => l.kind === "safari" && l.group !== "naturalist" },
  { key: "naturalists", label: "Naturalists", match: (l) => l.kind === "safari" && l.group === "naturalist" },
  { key: "transfers", label: "Road transfers", match: (l) => l.kind === "transfer" },
  { key: "flights", label: "Flights", match: (l) => l.kind === "addon" && l.group === "flight" },
  { key: "extras", label: "Experiences and extras", match: (l) => l.kind === "addon" && l.group !== "flight" && l.group !== "hotel" },
];

export function priceBreakdown(r: Pick<PriceResult, "lines" | "totals">): { rows: BreakdownRow[]; net: number; gst: number; total: number } {
  const lines = r.lines ?? [];
  const net = (ls: PriceLine[]) => ls.reduce((t, l) => t + (l.amount - (l.tax ?? 0)), 0);

  const service = SERVICE_ROWS.map((s) => ({ key: s.key, label: s.label, amount: net(lines.filter(s.match)) })).filter((x) => x.amount !== 0);
  // spread the markup over the services, in proportion; the rounding remainder goes to the biggest row
  const markup = r.totals?.markup ?? 0;
  const base = service.reduce((t, x) => t + x.amount, 0);
  if (markup && base > 0) {
    let given = 0;
    for (const x of service) {
      const share = Math.round((markup * x.amount) / base);
      x.amount += share;
      given += share;
    }
    const biggest = service.reduce((a, b) => (b.amount > a.amount ? b : a), service[0]);
    biggest.amount += markup - given;
  }

  const rows: BreakdownRow[] = [...service];
  const discount = net(lines.filter((l) => l.kind === "discount"));
  if (discount) rows.push({ key: "discount", label: "Discount", amount: discount });
  const adjustment = r.totals?.adjustment ?? 0;
  if (adjustment) rows.push({ key: "adjustment", label: adjustment < 0 ? "Special reduction" : "Other charges", amount: adjustment });
  const gst = lines.reduce((t, l) => t + (l.tax ?? 0), 0);
  const netTotal = rows.reduce((t, x) => t + x.amount, 0);
  const pkg = lines.find((l) => l.kind === "tax");
  rows.push({ key: "gst", label: pkg ? pkg.description : "GST", amount: gst });
  return { rows, net: netTotal, gst, total: netTotal + gst };
}

// Every priced line with its rate and GST: for the team to check the quote line by
// line, and for guests who ask for a detailed breakup. The markup is spread over
// the lines in proportion (never shown as a charge), like the summary above.
export interface DetailRow {
  lkey: string | null;
  date: string | null;
  label: string;
  quantity: number;
  net: number; // before GST
  gstPct: number | null;
  gst: number;
  amount: number; // incl. GST
  edited?: boolean;
  manual?: boolean;
  hike?: number;
}

export function detailedBreakdown(r: Pick<PriceResult, "lines" | "totals">, opts: { spreadMarkup: boolean } = { spreadMarkup: true }): { rows: DetailRow[]; total: number } {
  const lines = (r.lines ?? []).filter((l) => !l.missing && l.kind !== "markup" && l.kind !== "adjustment" && l.kind !== "tax");
  const rows: DetailRow[] = lines.map((l) => ({
    lkey: l.lkey ?? null,
    date: l.date,
    label: l.description,
    quantity: l.quantity,
    net: l.amount - (l.tax ?? 0),
    gstPct: l.tax_pct ?? (l.amount - l.tax ? Math.round(((l.tax ?? 0) / (l.amount - l.tax)) * 1000) / 10 : null),
    gst: l.tax ?? 0,
    amount: l.amount,
    ...(l.edited ? { edited: true } : {}),
    ...(l.manual ? { manual: true } : {}),
    ...(l.hike ? { hike: l.hike } : {}),
  }));
  const markup = r.totals?.markup ?? 0;
  if (markup && opts.spreadMarkup) {
    const base = rows.reduce((t, x) => t + Math.max(0, x.net), 0);
    if (base > 0) {
      let given = 0;
      for (const x of rows) {
        const share = x.net > 0 ? Math.round((markup * x.net) / base) : 0;
        x.net += share;
        x.amount += share;
        given += share;
      }
      const biggest = rows.reduce((a, b) => (b.net > a.net ? b : a), rows[0]);
      biggest.net += markup - given;
      biggest.amount += markup - given;
    }
  } else if (markup) {
    rows.push({ lkey: null, date: null, label: "Markup", quantity: 1, net: markup, gstPct: null, gst: 0, amount: markup });
  }
  const pkg = (r.lines ?? []).find((l) => l.kind === "tax");
  if (pkg) rows.push({ lkey: null, date: null, label: pkg.description, quantity: 1, net: 0, gstPct: pkg.tax_pct ?? null, gst: pkg.amount, amount: pkg.amount });
  const adjustment = r.totals?.adjustment ?? 0;
  if (adjustment) rows.push({ lkey: null, date: null, label: adjustment < 0 ? "Special reduction" : "Other charges", quantity: 1, net: adjustment, gstPct: null, gst: 0, amount: adjustment });
  return { rows, total: rows.reduce((t, x) => t + x.amount, 0) };
}
