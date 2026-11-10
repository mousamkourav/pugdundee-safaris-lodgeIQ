// Red Panda Master data: the checks on what the super admin types (pure; tested in master.test.ts).
import type { RpSettings } from "./types";

export const RP_IMAGE_PREFIX = "red-panda/";

// Rupees: a number, 0 or more, not text, not absurd. Commas and "Rs" are fine.
export function checkMoneyInput(v: unknown): number | null {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, "").replace(/^(rs\.?|inr)/i, ""));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
}

type Editable = Pick<
  RpSettings,
  | "gst_pct" | "package_nights" | "min_nights" | "max_nights" | "max_guests" | "max_rooms" | "min_age" | "deposit_pct" | "balance_days_before" | "hotel_property"
  | "airports" | "title" | "tagline" | "intro" | "stay_text" | "days" | "inclusions" | "exclusions" | "good_to_know" | "what_to_carry" | "payment_terms"
>;

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max) : "");
const list = (v: unknown, max: number, each: number) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []).map((x) => clean(x, each)).filter(Boolean).slice(0, max);

// What the settings screen sends: every field checked; problems listed, nothing guessed.
export function checkSettingsInput(raw: unknown): { data: Partial<Editable>; problems: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const data: Partial<Editable> = {};
  const nums: [keyof Editable, string, number, number][] = [
    ["gst_pct", "GST %", 0, 28],
    ["package_nights", "Package nights", 1, 30],
    ["min_nights", "Fewest nights", 1, 30],
    ["max_nights", "Most nights", 1, 30],
    ["max_guests", "Most guests", 1, 10],
    ["max_rooms", "Rooms at the Outpost", 1, 10],
    ["min_age", "Youngest age", 0, 30],
    ["deposit_pct", "Deposit %", 0, 100],
    ["balance_days_before", "Balance due (days before arrival)", 0, 365],
  ];
  for (const [k, label, min, max] of nums) {
    if (r[k] === undefined) continue;
    const n = Number(r[k]);
    if (!Number.isFinite(n) || n < min || n > max) problems.push(`${label}: a number from ${min} to ${max}.`);
    else (data as Record<string, unknown>)[k] = n;
  }
  if (data.min_nights != null && data.max_nights != null && data.min_nights > data.max_nights) problems.push("Fewest nights cannot be more than most nights.");
  if (r.airports !== undefined) {
    const a = Array.isArray(r.airports) ? (r.airports as Record<string, unknown>[]) : [];
    const out = a
      .filter((x) => x && (x.code === "IXB" || x.code === "BDP"))
      .map((x) => ({ code: x.code as "IXB" | "BDP", name: clean(x.name, 120), hours: Number(x.hours), note: clean(x.note, 300) || undefined }));
    for (const x of out) if (!x.name || !Number.isFinite(x.hours) || x.hours <= 0 || x.hours > 24) problems.push(`Airport ${x.code}: a name and the drive in hours (more than 0).`);
    if (!out.length) problems.push("At least one airport.");
    data.airports = out;
  }
  for (const k of ["title", "tagline", "hotel_property"] as const) if (r[k] !== undefined) data[k] = clean(r[k], 160);
  for (const k of ["intro", "stay_text", "payment_terms"] as const) if (r[k] !== undefined) data[k] = clean(r[k], 4000);
  for (const k of ["inclusions", "exclusions", "good_to_know", "what_to_carry"] as const) if (r[k] !== undefined) data[k] = list(r[k], 60, 1000);
  if (r.days !== undefined) {
    const d = Array.isArray(r.days) ? (r.days as Record<string, unknown>[]) : [];
    data.days = d.map((x) => ({ title: clean(x?.title, 160), text: clean(x?.text, 4000) })).filter((x) => x.title).slice(0, 4);
    if (data.days.length < 3) problems.push("Day by day: the texts for the arrival day, day 2 at the Outpost and the departure day (and day 3 onwards).");
  }
  if (data.title !== undefined && !data.title) problems.push("Give the title.");
  return { data, problems };
}
