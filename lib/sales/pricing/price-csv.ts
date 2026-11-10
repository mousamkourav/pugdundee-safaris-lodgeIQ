// The internal price check as a file for Excel (10 Nov 2026, G. Manager: "the rupee sign comes into
// the calculation"): plain numbers only (no Rs sign, no commas), one row per line with its rate per
// unit, so Qty x Rate = Before GST and Before GST + GST = Amount in every row, and a total that
// adds up. A CSV opens in Excel as numbers; the BOM keeps the service names' characters.
import type { DetailRow } from "./breakdown";

const r2 = (n: number) => Math.round(n * 100) / 100;
// the rate per unit before GST: Before GST / Qty (the table's "Before GST" is the whole line)
export const unitRate = (r: Pick<DetailRow, "net" | "quantity">) => (r.quantity > 0 ? r2(r.net / r.quantity) : r.net);

const cell = (v: string | number | null) => {
  if (v == null) return "";
  if (typeof v === "number") return String(r2(v));
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function priceCheckCsv(rows: DetailRow[], opts: { total: number; dateless?: boolean }): string {
  const head = [...(opts.dateless ? [] : ["Date"]), "Service", "Qty", "Rate before GST", "Before GST", "GST %", "GST", "Amount"];
  const lines = rows.map((r) => [
    ...(opts.dateless ? [] : [r.date ?? ""]),
    r.label,
    r.quantity,
    unitRate(r),
    r.net,
    r.gstPct ?? 0,
    r.gst,
    r.amount,
  ]);
  const sum = (f: (r: DetailRow) => number) => r2(rows.reduce((t, r) => t + f(r), 0));
  const total = [...(opts.dateless ? [] : [""]), "Total", "", "", sum((r) => r.net), "", sum((r) => r.gst), opts.total];
  return "﻿" + [head, ...lines, total].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}
