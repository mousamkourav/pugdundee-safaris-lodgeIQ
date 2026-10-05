// Formatting helpers for the Sales module. Source stays ASCII-only: the rupee
// sign is produced at runtime by Intl, never typed into the file.

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function rupees(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "-";
  const v = Number(n);
  return Number.isFinite(v) ? INR.format(v) : "-";
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "-";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "-" : DATE.format(date);
}

// "16 - 23 Jan 2027" style range for list views.
export function fmtRange(from?: string | null, to?: string | null) {
  if (!from && !to) return "-";
  if (!to) return fmtDate(from);
  if (!from) return fmtDate(to);
  return `${fmtDate(from)} - ${fmtDate(to)}`;
}

export function daysSince(iso: string | null | undefined, now = new Date()) {
  if (!iso) return 0;
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// First day of the current month in India, as an ISO timestamp for filters.
export function startOfMonthIST(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000); // shift to IST wall clock
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  return new Date(Date.UTC(y, m, 1) - 330 * 60_000).toISOString();
}
