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
  rows.push({ key: "gst", label: "GST", amount: gst });
  return { rows, net: netTotal, gst, total: netTotal + gst };
}
