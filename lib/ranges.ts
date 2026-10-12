// Pure date-range helpers for the dashboard calendar presets.
// No server-only imports here, so this is safe to import from client components.

export type RangePreset = {
  key: string;
  label: string;
  months: number; // window length; 0 = custom
  endOffset?: number; // months before the current month the window ends (default 0)
};

export const RANGE_PRESETS: RangePreset[] = [
  // The previous calendar month only (monthly reports are filed after the
  // month ends, so this is the most recent complete month).
  { key: "last", label: "Last month", months: 1, endOffset: 1 },
  { key: "current", label: "This month", months: 1 },
  { key: "3m", label: "Last 3 months", months: 3 },
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "12m", label: "Last 12 months", months: 12 },
  { key: "custom", label: "Custom range", months: 0 },
];

export const DEFAULT_RANGE = "last";

// "YYYY-MM" + delta months -> "YYYY-MM"
export function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type ResolvedRange = { start: string; end: string; key: string };

// Resolve a preset (or custom from/to) into an inclusive [start, end] of YYYY-MM.
// Anchored to the current month (todayYM): "last N months" is the calendar
// window ending this month; "last" (Last month) is just the previous calendar
// month, e.g. todayYM 2026-10 -> 2026-09..2026-09. Unknown keys fall back to
// DEFAULT_RANGE.
export function resolveRange(
  preset: string | undefined,
  todayYM: string,
  from?: string,
  to?: string
): ResolvedRange {
  if (preset === "custom") {
    const a = from || todayYM;
    const b = to || todayYM;
    const [start, end] = a <= b ? [a, b] : [b, a];
    return { start, end, key: "custom" };
  }
  const found =
    RANGE_PRESETS.find((p) => p.key === preset && p.months > 0) ??
    RANGE_PRESETS.find((p) => p.key === DEFAULT_RANGE)!;
  const end = ymAdd(todayYM, -(found.endOffset ?? 0));
  return { start: ymAdd(end, -(found.months - 1)), end, key: found.key };
}

export function inRange(ym: string, r: { start: string; end: string }): boolean {
  return ym >= r.start && ym <= r.end;
}

// "2026-09" -> "Sep 2026". Client-safe (lib/dashboard.ts pulls in the server
// Supabase client, so the dashboard's monthLabel cannot be used in the picker).
export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
