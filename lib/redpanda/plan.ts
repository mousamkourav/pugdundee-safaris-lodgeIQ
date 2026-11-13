// A Red Panda quote coming from the browser, checked field by field (never trusted), the empty
// quote, and the settings read from rp_settings with safe defaults. Pure.
import type { AirportCode, RpCustomItem, RpPlan, RpSettings } from "./types";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const airport = (v: unknown): AirportCode => (v === "BDP" ? "BDP" : "IXB");
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
const uuidOrNull = (v: unknown) => (typeof v === "string" && /^[0-9a-zA-Z_-]{1,64}$/.test(v) ? v : null);

export const isRedPandaPlan = (p: unknown): boolean => !!p && typeof p === "object" && (p as { kind?: unknown }).kind === "red_panda";

export function emptyRpPlan(): RpPlan {
  return {
    kind: "red_panda",
    guest: { name: "", email: "", phone: "", country: "", nationality: "foreign", booked_by: "direct", agent_name: "", adults: 2, child_ages: [], rooms: null },
    arrival: null,
    nights: 5,
    arrive_airport: "IXB",
    depart_airport: "IXB",
    tour_leader: false,
    hotel_before: { nights: 0, room_id: null },
    hotel_after: { nights: 0, room_id: null },
    delhi_before: { flight: false, nights: 0, hotel_id: null, room_id: null },
    delhi_after: { flight: false, nights: 0, hotel_id: null, room_id: null },
    flight_fare_pp: null,
    custom_items: [],
    per_pax_override: null,
    markup_pct: 0,
    discount: 0,
    adjustment: { amount: 0, reason: "" },
    notes: "",
    enquiry: "",
    confirmed: null,
    text: { intro: "", days: {}, notes: [] },
  };
}

// Money stays as typed so the price can refuse a negative (it is never silently made positive).
export function sanitizeRpPlan(raw: unknown): RpPlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const g = (r.guest && typeof r.guest === "object" ? r.guest : {}) as Record<string, unknown>;
  const ages = Array.isArray(g.child_ages) ? g.child_ages.slice(0, 10).map((a) => int(a, 0, 120, 0)) : [];
  const roomsRaw = g.rooms;
  const items: RpCustomItem[] = Array.isArray(r.custom_items)
    ? r.custom_items.slice(0, 20).map((c) => {
        const x = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
        return { label: str(x.label, 120), amount: money(x.amount), gst_pct: money(x.gst_pct) };
      })
    : [];
  const stay = (v: unknown) => {
    const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { nights: int(x.nights, 0, 10, 0), room_id: uuidOrNull(x.room_id) };
  };
  const delhi = (v: unknown) => {
    const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const nights = int(x.nights, 0, 10, 0);
    return { flight: x.flight === true || nights > 0, nights, hotel_id: uuidOrNull(x.hotel_id), room_id: uuidOrNull(x.room_id) };
  };
  const fare = r.flight_fare_pp === null || r.flight_fare_pp === undefined || r.flight_fare_pp === "" ? null : money(r.flight_fare_pp);
  const adj = (r.adjustment && typeof r.adjustment === "object" ? r.adjustment : {}) as Record<string, unknown>;
  const override = r.per_pax_override === null || r.per_pax_override === undefined || r.per_pax_override === "" ? null : money(r.per_pax_override);
  return {
    kind: "red_panda",
    guest: {
      name: str(g.name, 120),
      email: str(g.email, 160),
      phone: str(g.phone, 40),
      country: str(g.country, 60),
      nationality: g.nationality === "indian" ? "indian" : "foreign",
      booked_by: g.booked_by === "agent" ? "agent" : "direct",
      agent_name: str(g.agent_name, 120),
      adults: int(g.adults, 0, 20, 0),
      child_ages: ages,
      rooms: roomsRaw === null || roomsRaw === undefined || roomsRaw === "" ? null : int(roomsRaw, 0, 20, 0),
    },
    arrival: date(r.arrival),
    ...(r.dateless === true ? { dateless: true, rate_season: typeof r.rate_season === "string" && /^[\w -]{1,40}$/.test(r.rate_season) ? r.rate_season : null } : {}),
    nights: int(r.nights, 0, 30, 5),
    arrive_airport: airport(r.arrive_airport),
    depart_airport: airport(r.depart_airport),
    tour_leader: r.tour_leader === true,
    hotel_before: stay(r.hotel_before),
    hotel_after: stay(r.hotel_after),
    delhi_before: delhi(r.delhi_before),
    delhi_after: delhi(r.delhi_after),
    flight_fare_pp: fare,
    custom_items: items,
    per_pax_override: override,
    markup_pct: money(r.markup_pct),
    discount: money(r.discount),
    adjustment: { amount: money(adj.amount), reason: str(adj.reason, 300) },
    notes: str(r.notes, 2000),
    enquiry: typeof r.enquiry === "string" ? r.enquiry.replace(/\r/g, "").slice(0, 6000) : "",
    confirmed: typeof r.confirmed === "string" && r.confirmed.length <= 1000 ? r.confirmed : null,
    text: guestText(r.text),
  };
}

// the Final draft's text for this quote: plain text, limited
const long = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max) : "");
function guestText(v: unknown): RpPlan["text"] {
  const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const days: Record<string, string> = {};
  if (x.days && typeof x.days === "object")
    for (const [k, t] of Object.entries(x.days as Record<string, unknown>).slice(0, 40)) {
      if (/^\d{1,2}$/.test(k) && long(t, 3000)) days[k] = long(t, 3000);
    }
  const notes = Array.isArray(x.notes) ? x.notes.map((n) => long(n, 500)).filter(Boolean).slice(0, 20) : [];
  return { intro: long(x.intro, 4000), days, notes };
}

export const DEFAULT_SETTINGS: RpSettings = {
  gst_pct: 5,
  package_nights: 5,
  min_nights: 4,
  max_nights: 10,
  max_guests: 10,
  max_rooms: 5,
  min_age: 16,
  closed_months: [6, 7, 8, 9],
  deposit_pct: 50,
  balance_days_before: 45,
  hotel_property: "Mayfair",
  airports: [
    { code: "IXB", name: "Bagdogra Airport (IXB), Siliguri, India", hours: 5 },
    { code: "BDP", name: "Bhadrapur (Chandragadhi) Airport (BDP), Nepal", hours: 3.5 },
  ],
  title: "Red Panda Outpost",
  tagline: "A Pugdundee Safaris experience",
  intro: "",
  stay_text: "",
  days: [],
  inclusions: [],
  exclusions: [],
  good_to_know: [],
  what_to_carry: [],
  payment_terms: "",
};

// rp_settings.data -> settings; anything missing or of the wrong kind takes the default.
export function readSettings(data: unknown): RpSettings {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const n = (k: keyof RpSettings, min: number, max: number) => {
    const v = Number(d[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : (DEFAULT_SETTINGS[k] as number);
  };
  const strs = (k: keyof RpSettings) => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter((x): x is string => typeof x === "string") : (DEFAULT_SETTINGS[k] as string[]));
  const s = (k: keyof RpSettings) => (typeof d[k] === "string" ? (d[k] as string) : (DEFAULT_SETTINGS[k] as string));
  const airports = Array.isArray(d.airports)
    ? (d.airports as Record<string, unknown>[])
        .filter((a) => a && (a.code === "IXB" || a.code === "BDP"))
        .map((a) => ({ code: a.code as AirportCode, name: String(a.name ?? a.code), hours: Number(a.hours) || 0, note: typeof a.note === "string" ? a.note : undefined }))
    : DEFAULT_SETTINGS.airports;
  const days = Array.isArray(d.days)
    ? (d.days as Record<string, unknown>[]).filter((x) => x && typeof x.title === "string").map((x) => ({ title: String(x.title), text: String(x.text ?? "") }))
    : [];
  const months = Array.isArray(d.closed_months) ? (d.closed_months as unknown[]).map(Number).filter((m) => m >= 1 && m <= 12) : DEFAULT_SETTINGS.closed_months;
  return {
    gst_pct: n("gst_pct", 0, 28),
    package_nights: n("package_nights", 1, 30),
    min_nights: n("min_nights", 1, 30),
    max_nights: n("max_nights", 1, 30),
    max_guests: n("max_guests", 1, 10),
    max_rooms: n("max_rooms", 1, 10),
    min_age: n("min_age", 0, 30),
    closed_months: months,
    deposit_pct: n("deposit_pct", 0, 100),
    balance_days_before: n("balance_days_before", 0, 365),
    hotel_property: s("hotel_property"),
    airports: airports.length ? airports : DEFAULT_SETTINGS.airports,
    title: s("title"),
    tagline: s("tagline"),
    intro: s("intro"),
    stay_text: s("stay_text"),
    days,
    inclusions: strs("inclusions"),
    exclusions: strs("exclusions"),
    good_to_know: strs("good_to_know"),
    what_to_carry: strs("what_to_carry"),
    payment_terms: s("payment_terms"),
  };
}
