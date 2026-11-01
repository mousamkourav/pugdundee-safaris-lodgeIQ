// =====================================================================
// The evidence rule for the AI's reading of a chat message.
//
// The AI answers with every value next to the exact words of the message that say it:
//   { "adults": { "value": 2, "quote": "2 adults" }, "stops": [{ "park": { "value": "Kanha
//     National Park", "quote": "kanha 2 raat" }, "nights": { "value": 2, "quote": "2 raat" } }] }
// checkEvidence keeps a value only when
//   1. its quote is in the message (case-insensitive, small typos allowed), and
//   2. the quote states that value: the number of nights or adults, each child's age, the
//      lodge's or park's name, the room, the city, the day of the date...
// Anything else is dropped (and listed), never guessed: the AI can never choose a lodge, a
// room, nights or ages the message does not state. What is kept comes back in the plain
// shape aiToParsed reads (lib/sales/plan/ai.ts), which then checks it against Master data.
// Pure, so it is tested without a network.
// =====================================================================

import { EXTRA_WORDS, REQUESTS, aliasesOf, lodgeAliases } from "./parse-text";
import { safariOnly } from "./cities";
import type { BuilderContext } from "./types";

// ---------------- text matching ----------------

// lower case, letters and digits only, single spaces
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Edits between two words, a swap of two letters next to each other counting as one ("kahna").
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// small typos allowed: none in short words (and never in numbers), 1 in 4-6 letters, 2 above
const tolerance = (s: string) => (/\d/.test(s) || s.length <= 3 ? 0 : s.length <= 6 ? 1 : 2);

// Is the phrase in the text, word for word, allowing small typos ("kahna" for "kanha")?
export function phraseIn(phrase: string, text: string): boolean {
  const p = norm(phrase);
  const t = norm(text);
  if (!p || !t) return false;
  if (` ${t} `.includes(` ${p} `)) return true;
  const pw = p.split(" ");
  const tw = t.split(" ");
  for (let i = 0; i + pw.length <= tw.length; i++) {
    if (pw.every((w, k) => lev(w, tw[i + k]) <= tolerance(w))) return true;
  }
  return false;
}

// Is the quote in the message? Case-insensitive; small typos and a missing or extra word allowed
// (the AI sometimes tidies a quote), but never a different number.
export function quoteFound(quote: unknown, message: string): boolean {
  if (typeof quote !== "string") return false;
  const q = norm(quote);
  if (q.replace(/ /g, "").length < 2) return false;
  // A quote does not run across a comma, a full stop or a new line unless it has one itself:
  // in "3 nights Kanha, 2 nights Pench" the words "Kanha, 2 nights" are two parts of the trip.
  const parts = /[,;.\n]/.test(quote) ? [message] : message.split(/[,;.\n]+/);
  return parts.some((part) => foundIn(q, part));
}

function foundIn(q: string, message: string): boolean {
  if (phraseIn(q, message)) return true;
  const qw = q.split(" ");
  const tw = norm(message).split(" ");
  const digits = (ws: string[]) => ws.filter((w) => /\d/.test(w)).join(" ");
  for (const k of [qw.length - 1, qw.length + 1]) {
    if (k < 2) continue;
    for (let i = 0; i + k <= tw.length; i++) {
      const win = tw.slice(i, i + k);
      if (digits(win) !== digits(qw)) continue; // numbers exactly as written
      const d = lev(qw.join(" "), win.join(" "));
      if (d <= Math.max(1, Math.floor(q.length * 0.15))) return true;
    }
  }
  return false;
}

// ---------------- does the quote state the value? ----------------

const NUMBER_WORDS: Record<number, string[]> = {
  1: ["one", "a", "an", "single", "ek", "solo", "alone"],
  2: ["two", "couple", "pair", "both", "do", "dono", "twin"],
  3: ["three", "teen", "tin"],
  4: ["four", "char", "chaar"],
  5: ["five", "paanch", "panch"],
  6: ["six", "chhe", "che", "chhah"],
  7: ["seven", "saat", "sat"],
  8: ["eight", "aath", "ath"],
  9: ["nine", "nau"],
  10: ["ten", "das"],
  11: ["eleven", "gyarah"],
  12: ["twelve", "barah"],
};
// the number written as digits or a word ("3", "three", "teen"; "couple" for 2)
export function statesNumber(quote: string, n: number): boolean {
  const ws = norm(quote).replace(/(\d+)(st|nd|rd|th|n|nts?|nights?|pax|yrs?|years?|days?|d)\b/g, "$1 $2").split(" ");
  return ws.includes(String(n)) || (NUMBER_WORDS[n] ?? []).some((w) => ws.includes(w));
}
const ALL_WORDS = /\b(all|every|each|sab|sabhi|har)\b/;

type Ctx = BuilderContext;

const parkNamesIn = (ctx: Ctx, park: string) => {
  const p = ctx.pricing.parks.find((x) => x.name.toLowerCase() === park.toLowerCase());
  const lodges = p ? ctx.properties.filter((l) => l.park_id === p.id) : [];
  const parkAliases = aliasesOf(park);
  return [...parkAliases, ...lodges.flatMap((l) => lodgeAliases(l.name, parkAliases))];
};
const lodgeNames = (ctx: Ctx, lodge: string) => {
  const l = ctx.properties.find((x) => x.name.toLowerCase() === lodge.toLowerCase());
  const park = l ? ctx.pricing.parks.find((p) => p.id === l.park_id)?.name ?? "" : "";
  return lodgeAliases(lodge, aliasesOf(park));
};
const ROOM_WORDS: Record<string, RegExp> = {
  cottage: /\bcottages?\b/,
  tree: /\btree\s*houses?\b|\btreehouses?\b/,
  suite: /\bsuites?\b/,
  deluxe: /\bdeluxe\b/,
};
// a place or city: its name without "Airport", "Railway Station"... ("Jabalpur" for "Jabalpur Airport")
const placeCore = (name: string) => norm(name.replace(/\(.*?\)/g, " ")).replace(/\b(international|domestic|airport|railway|station|junction|jn|city)\b/g, " ").replace(/\s+/g, " ").trim();
const namesAny = (names: string[], quote: string) => names.some((n) => n.length >= 3 && phraseIn(n, quote));

// ---------------- the check ----------------

export interface Dropped {
  field: string;
  value: unknown;
  quote: unknown;
  reason: "no quote" | "quote not in the message" | "quote does not say it";
}

interface Ev {
  value?: unknown;
  quote?: unknown;
}
const ev = (x: unknown): Ev => (x && typeof x === "object" && !Array.isArray(x) ? (x as Ev) : {});
const list = (x: unknown) => (Array.isArray(x) ? x : []);

export function checkEvidence(raw: unknown, message: string, full: Ctx): { reading: Record<string, unknown>; dropped: Dropped[] } {
  const ctx = safariOnly(full);
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  const dropped: Dropped[] = [];

  // the value, when its quote is in the message and states it (says = the value's own test)
  const take = (field: string, x: unknown, says: (quote: string, value: unknown) => boolean = () => true): unknown => {
    const e = ev(x);
    if (e.value === undefined || e.value === null || (Array.isArray(e.value) && !e.value.length) || e.value === "") return undefined;
    if (typeof e.quote !== "string" || !e.quote.trim()) {
      dropped.push({ field, value: e.value, quote: e.quote, reason: "no quote" });
      return undefined;
    }
    if (!quoteFound(e.quote, message)) {
      dropped.push({ field, value: e.value, quote: e.quote, reason: "quote not in the message" });
      return undefined;
    }
    if (!says(e.quote, e.value)) {
      dropped.push({ field, value: e.value, quote: e.quote, reason: "quote does not say it" });
      return undefined;
    }
    return e.value;
  };
  const num = (q: string, v: unknown) => typeof v === "number" && statesNumber(q, v);
  const set = (key: string, v: unknown) => {
    if (v !== undefined) out[key] = v;
  };

  // ---- guests
  set("adults", take("adults", o.adults, num));
  set("children_ages", take("children_ages", o.children_ages, (q, v) => Array.isArray(v) && v.every((a) => typeof a === "number" && statesNumber(q, a))));
  set("rooms", take("rooms", o.rooms, num));
  set("country", take("country", o.country));
  set("nationality", take("nationality", o.nationality));

  // ---- dates and places
  set(
    "arrival_date",
    take("arrival_date", o.arrival_date, (q, v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && statesNumber(q, Number(v.slice(8, 10))))
  );
  const place = (q: string, v: unknown) => typeof v === "string" && !!placeCore(v) && phraseIn(placeCore(v), q);
  set("arrival_place", take("arrival_place", o.arrival_place, place));
  set("departure_place", take("departure_place", o.departure_place, place));
  set("meal_plan", take("meal_plan", o.meal_plan));

  // ---- how they travel and what they ask for
  const mode = (q: string, v: unknown) =>
    (v === "own" && /\b(own|self|apni|khud|their)\b/.test(norm(q))) ||
    (v === "train" && /\btrain\b/.test(norm(q))) ||
    (v === "flight" && /\b(fly|flying|flight|flights|air)\b/.test(norm(q))) ||
    (v === "transfer" && /\b(car|cab|transfer|pick|drop|our)\b/.test(norm(q))) ||
    (v === "ours" && /\b(our|car|transfer)\b/.test(norm(q)));
  set("arrival_mode", take("arrival_mode", o.arrival_mode, mode));
  set("departure_mode", take("departure_mode", o.departure_mode, mode));
  set("between", take("between", o.between, mode));
  set("own_all", take("own_all", o.own_all, (q, v) => v === true && /\b(own|self|apni|khud)\b/.test(norm(q))));
  const requests = list(o.requests)
    .map((r, i) => take(`requests[${i}]`, r, (q, v) => REQUESTS.some(([re, name]) => name === v && re.test(q.toLowerCase()))))
    .filter((x) => x !== undefined);
  if (requests.length) out.requests = requests;

  // ---- changes to the trip so far
  set("replace_route", take("replace_route", o.replace_route, (_q, v) => v === true));
  set("reverse", take("reverse", o.reverse, (_q, v) => v === true));
  const parkIn = (q: string, v: unknown) => typeof v === "string" && namesAny(parkNamesIn(ctx, v), q);
  set("order", take("order", o.order, (q, v) => Array.isArray(v) && v.length > 1 && v.every((p) => parkIn(q, p))));
  const removes = list(o.remove_parks)
    .map((r, i) => take(`remove_parks[${i}]`, r, parkIn))
    .filter((x) => x !== undefined);
  if (removes.length) out.remove_parks = removes;

  // ---- the stops: the park (or the lodge) must be quoted; each detail its own quote
  const stops: Record<string, unknown>[] = [];
  list(o.stops).forEach((sRaw, i) => {
    const s = sRaw && typeof sRaw === "object" ? (sRaw as Record<string, unknown>) : {};
    const f = (k: string) => `stops[${i}].${k}`;
    const lodge = take(f("lodge"), s.lodge, (q, v) => typeof v === "string" && namesAny(lodgeNames(ctx, v), q)) as string | undefined;
    const park = take(f("park"), s.park, parkIn) as string | undefined;
    if (!park && !lodge) return; // a stop the message does not name is not a stop
    const room = take(f("room"), s.room, (q, v) => typeof v === "string" && !!ROOM_WORDS[v]?.test(norm(q)));
    const nights = take(f("nights"), s.nights, num);
    const safaris = take(f("safaris"), s.safaris, (q, v) => typeof v === "number" && (statesNumber(q, v) || (v > 0 && ALL_WORDS.test(norm(q)) && /\bsafari/.test(norm(q)))) && /safari|jeep|drive|game/.test(norm(q)));
    const naturalists = take(f("naturalists"), s.naturalists, (q, v) => typeof v === "number" && /naturalist|guide/.test(norm(q)) && (v === -1 ? ALL_WORDS.test(norm(q)) || /\bwith (a )?naturalists?\b/.test(norm(q)) : statesNumber(q, v)));
    const extras = list(s.extras)
      .map((x, k) => take(`${f("extras")}[${k}]`, x, (q, v) => typeof v === "string" && (EXTRA_WORDS.some(([re, kw]) => kw === v && re.test(q.toLowerCase())) || (v === "special" && /\b(special|unique|signature)\b/.test(norm(q))) || phraseIn(v, q))))
      .filter((x) => x !== undefined);
    stops.push({
      ...(park ? { park } : {}),
      ...(lodge ? { lodge } : {}),
      ...(room !== undefined ? { room } : {}),
      ...(nights !== undefined ? { nights } : {}),
      ...(safaris !== undefined ? { safaris } : {}),
      ...(naturalists !== undefined ? { naturalists } : {}),
      ...(extras.length ? { extras } : {}),
    });
  });
  if (stops.length) out.stops = stops;

  // ---- city nights: the city and its nights quoted; the hotel only when named
  const stays: Record<string, unknown>[] = [];
  list(o.city_stays).forEach((cRaw, i) => {
    const c = cRaw && typeof cRaw === "object" ? (cRaw as Record<string, unknown>) : {};
    const f = (k: string) => `city_stays[${i}].${k}`;
    const hotel = take(f("hotel"), c.hotel, (q, v) => typeof v === "string" && norm(v).split(" ").some((w) => w.length >= 4 && phraseIn(w, q)));
    const city = take(f("city"), c.city, (q, v) => typeof v === "string" && phraseIn(placeCore(v), q)) ?? (hotel ? ev(c.city).value : undefined);
    const nights = take(f("nights"), c.nights, num);
    if (typeof city !== "string" || nights === undefined) return;
    stays.push({
      when: c.when === "before" ? "before" : "after",
      city,
      nights,
      ...(hotel ? { hotel } : {}),
      ...(typeof c.at === "number" ? { at: c.at } : {}),
    });
  });
  if (stays.length) out.city_stays = stays;

  // ---- flights: where they fly to is quoted; where from is in the message (often said once)
  const flights: Record<string, unknown>[] = [];
  list(o.flights).forEach((fRaw, i) => {
    const fl = fRaw && typeof fRaw === "object" ? (fRaw as Record<string, unknown>) : {};
    const q = fl.quote;
    const to = typeof fl.to === "string" ? fl.to : "";
    const from = typeof fl.from === "string" ? fl.from : "";
    const why = !to || !from || typeof q !== "string" || !q.trim() ? "no quote" : !quoteFound(q, message) ? "quote not in the message" : !phraseIn(placeCore(to), q) || !phraseIn(placeCore(from), message) ? "quote does not say it" : null;
    if (why) {
      dropped.push({ field: `flights[${i}]`, value: `${from} > ${to}`, quote: q, reason: why });
      return;
    }
    const time = typeof fl.time === "string" && /^\d{1,2}:\d{2}$/.test(fl.time) && fl.time.split(":").every((x) => norm(q as string).includes(String(Number(x)))) ? fl.time : undefined;
    flights.push({ from, to, ...(time ? { time } : {}) });
  });
  if (flights.length) out.flights = flights;

  return { reading: out, dropped };
}
