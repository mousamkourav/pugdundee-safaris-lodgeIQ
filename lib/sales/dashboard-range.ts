// The period the Sales dashboard counts. Pure (no I/O) so it can be tested.
//
// Default = ALL TIME: every query since the start. The other choices are calendar
// periods in India time (Asia/Kolkata, UTC+5:30, no daylight saving). A period is
// [from, to): `from` inclusive, `to` exclusive, both ISO timestamps for created_at
// filters; `null` means "no limit on that side".
//
// URL: ?range=all|month|last|last3|year|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD, both inclusive days).

export const RANGE_KEYS = ["all", "month", "last", "last3", "year", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABEL: Record<RangeKey, string> = {
  all: "All time",
  month: "This month",
  last: "Last month",
  last3: "Last 3 months",
  year: "This year",
  custom: "Custom range",
};

export interface DashboardRange {
  key: RangeKey;
  from: string | null; // ISO, inclusive
  to: string | null; // ISO, exclusive
  fromDay: string | null; // YYYY-MM-DD (IST) of the first day counted
  toDay: string | null; // YYYY-MM-DD (IST) of the last day counted
  label: string; // "All queries" / "Queries created 1 Nov 2026 to 2 Nov 2026"
  note?: string; // why the request was changed (bad custom dates)
}

const IST_MIN = 330;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Midnight in India of the given calendar day, as an ISO timestamp.
function istMidnight(y: number, m0: number, d: number) {
  return new Date(Date.UTC(y, m0, d) - IST_MIN * 60_000).toISOString();
}

// The India wall-clock calendar parts of a moment.
function istParts(now: Date) {
  const ist = new Date(now.getTime() + IST_MIN * 60_000);
  return { y: ist.getUTCFullYear(), m0: ist.getUTCMonth(), d: ist.getUTCDate() };
}

function dayOf(iso: string) {
  // India calendar day of an ISO moment.
  const p = istParts(new Date(iso));
  return `${p.y}-${String(p.m0 + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function parseDay(s: string | undefined | null) {
  const m = DAY_RE.exec((s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const m0 = Number(m[2]) - 1;
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, m0, d));
  // reject 2026-02-31 and friends
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m0 || t.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return { y, m0, d };
}

const FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDayLabel = (day: string) => FMT.format(new Date(day + "T00:00:00Z"));

export function isRangeKey(v: unknown): v is RangeKey {
  return typeof v === "string" && (RANGE_KEYS as readonly string[]).includes(v);
}

export function resolveDashboardRange(
  sp: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date(),
): DashboardRange {
  const key: RangeKey = isRangeKey(sp.range) ? sp.range : "all";
  const { y, m0, d } = istParts(now);
  const today = `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const tomorrow = istMidnight(y, m0, d + 1);

  const make = (k: RangeKey, from: string | null, to: string | null, note?: string): DashboardRange => {
    const fromDay = from ? dayOf(from) : null;
    // `to` is exclusive: the last day counted is the day before it (or today when open-ended)
    const toDay = to ? dayOf(new Date(Date.parse(to) - 60_000).toISOString()) : from ? today : null;
    const label = !from && !to ? "All queries, since the start" : `Queries created ${fmtDayLabel(fromDay ?? today)} to ${fmtDayLabel(toDay ?? today)}`;
    return { key: k, from, to, fromDay, toDay, label, ...(note ? { note } : {}) };
  };

  switch (key) {
    case "all":
      return make("all", null, null);
    case "month":
      return make("month", istMidnight(y, m0, 1), tomorrow);
    case "last":
      return make("last", istMidnight(y, m0 - 1, 1), istMidnight(y, m0, 1));
    case "last3":
      // the two months before this one and this month so far
      return make("last3", istMidnight(y, m0 - 2, 1), tomorrow);
    case "year":
      return make("year", istMidnight(y, 0, 1), tomorrow);
    case "custom": {
      let a = parseDay(sp.from);
      let b = parseDay(sp.to);
      if (!a && !b) return make("all", null, null, "Choose a start and/or end date for a custom range. Showing all time.");
      if (a && b && Date.UTC(a.y, a.m0, a.d) > Date.UTC(b.y, b.m0, b.d)) [a, b] = [b, a];
      const from = a ? istMidnight(a.y, a.m0, a.d) : null;
      const to = b ? istMidnight(b.y, b.m0, b.d + 1) : null;
      const r = make("custom", from, to);
      if (!from) r.label = `Queries created up to ${fmtDayLabel(r.toDay!)}`;
      if (!from) r.fromDay = null;
      return r;
    }
  }
}

// The URL for a period (keeps /sales clean for the default).
export function rangeHref(path: string, r: Pick<DashboardRange, "key" | "fromDay" | "toDay">) {
  if (r.key === "all") return path;
  const p = new URLSearchParams({ range: r.key });
  if (r.key === "custom") {
    if (r.fromDay) p.set("from", r.fromDay);
    if (r.toDay) p.set("to", r.toDay);
  }
  return `${path}?${p.toString()}`;
}

// Is a created_at inside the period?
export function inRange(createdAt: string | null | undefined, r: Pick<DashboardRange, "from" | "to">) {
  if (!r.from && !r.to) return true;
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return (!r.from || t >= Date.parse(r.from)) && (!r.to || t < Date.parse(r.to));
}
