// Display units for numeric values. The truth about whether a number is money
// or a count lives in the SECTIONS config (lib/monthly.ts); this module only
// knows how to render each unit. Never decide money-ness at the call site.
export type Unit = "money" | "count" | "litres" | "km" | "reading" | "rating";

export function inr(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return "\u20B9" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Plain number, grouped Indian-style, no currency sign.
function plain(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Render a value according to its unit. Counts, readings and anything unknown
// fall back to a plain number: a missing currency sign is cosmetic, a rupee
// sign on a room count is a trust problem.
export function formatValue(unit: Unit | undefined, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "-";
  const num = Number(raw);
  if (!Number.isFinite(num)) return String(raw);
  switch (unit) {
    case "money":
      return inr(num);
    case "litres":
      return plain(num) + " L";
    case "km":
      return plain(num) + " km";
    case "rating":
      return num.toFixed(1);
    default:
      return plain(num);
  }
}

// Current month in India time. The server runs in UTC, so new Date().getMonth()
// still says the previous month until 05:30 IST on the 1st.
export function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
}

// month = "YYYY-MM" -> inclusive start, exclusive end (first of next month), label
export function monthRange(month: string): {
  start: string;
  end: string;
  label: string;
} {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = start.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { start: iso(start), end: iso(end), label };
}
