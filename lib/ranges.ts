// Pure date-range helpers for the dashboard calendar presets.
// No server-only imports here, so this is safe to import from client components.

export type RangePreset = {
  key: string;
  label: string;
  months: number; // 0 = custom
};

export const RANGE_PRESETS: RangePreset[] = [
  { key: "current", label: "This month", months: 1 },
  { key: "3m", label: "Last 3 months", months: 3 },
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "12m", label: "Last 12 months", months: 12 },
  { key: "24m", label: "Last 24 months", months: 24 },
  { key: "custom", label: "Custom range…", months: 0 },
];

export const DEFAULT_RANGE = "3m";

// "YYYY-MM" + delta months -> "YYYY-MM"
export function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type ResolvedRange = { start: string; end: string; key: string };

// Resolve a preset (or custom from/to) into an inclusive [start, end] of YYYY-MM.
// Anchored to the current month (todayYM) so "last N months" means the calendar
// window ending this month.
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
  const found = RANGE_PRESETS.find((p) => p.key === preset && p.months > 0);
  const months = found ? found.months : 3;
  const key = found ? found.key : DEFAULT_RANGE;
  return { start: ymAdd(todayYM, -(months - 1)), end: todayYM, key };
}

export function inRange(ym: string, r: { start: string; end: string }): boolean {
  return ym >= r.start && ym <= r.end;
}
