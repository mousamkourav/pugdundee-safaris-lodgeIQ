// =====================================================================
// One reading flow for the trip assistant, AI first:
//   1. memory   - a saved reading of the same enquiry (or the same enquiry with only
//                 dates, numbers or names changed): used as it is, no AI call
//   2. AI       - every message (except a short reply to the assistant's own question).
//                 Each value must quote the words of the message that say it (evidence.ts);
//                 what has no valid quote is dropped, never guessed
//   3. reader   - the built-in reader (parse-text.ts): the whole reading when the AI is off,
//                 fails or times out; otherwise it fills only what the AI left empty
//                 (mergeAiFirst). There is no "I read X, the AI read Y" question.
// Everything from memory or the AI goes through aiToParsed (checked against master data).
// Pure, so it is tested without a database or the network.
// =====================================================================

import type { ISODate } from "@/lib/sales/pricing/types";
import { addDays } from "@/lib/sales/pricing/dates";
import { applyRules, scrubForAI, type Ask, type ParsedPark, type ParsedTrip } from "./parse-text";
import type { BuilderContext, Plan } from "./types";

// ---------------------------------------------------------------- normalising

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// The enquiry as the memory compares it: names, emails and phone numbers removed, the
// reader's taught phrases applied, lower case, numbers as digits, punctuation and spaces
// tidied. Two enquiries written the same way give the same text.
export function normaliseEnquiry(text: string, rules: { phrase: string; meaning: string }[] = [], names: string[] = []): string {
  let t = scrubForAI(text, names);
  t = applyRules(t, rules);
  t = t.toLowerCase().replace(/[‘’ʼ]/g, "'");
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => String(NUMBER_WORDS[w]));
  return t
    .replace(/[^a-z0-9,\-/:.'@\[\] ]+/g, " ")
    .replace(/\s*([,.])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/[\s,.]+$/, "")
    .trim();
}

// A date or a number in the enquiry, in the order written. A date keeps the day it was
// read as when the pattern was saved, so a later enquiry can shift the trip to its own date.
export type Token = { kind: "n"; value: number } | { kind: "d"; raw: string; iso?: ISODate };

const DATE_RES = [
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}\\b(?:,?\\s*(\\d{4}|\\d{2})\\b)?`, "g"),
  new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4})\\b)?`, "g"),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?\b/g,
];

// The enquiry with every date as "#d" and every other number as "#", and the tokens taken out.
export function structureOf(norm: string, today?: ISODate): { structure: string; tokens: Token[] } {
  const spans: { at: number; end: number; token: Token }[] = [];
  const free = (a: number, b: number) => !spans.some((s) => a < s.end && b > s.at);
  for (const re of DATE_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      if (!free(m.index, m.index + m[0].length)) continue;
      const iso = today ? dateOf(m[0], today) ?? undefined : undefined;
      if (today && !iso) continue; // "3/4 safaris" is not a date
      spans.push({ at: m.index, end: m.index + m[0].length, token: { kind: "d", raw: m[0], ...(iso ? { iso } : {}) } });
    }
  }
  const numRe = /\d+/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(norm))) {
    if (free(m.index, m.index + m[0].length)) spans.push({ at: m.index, end: m.index + m[0].length, token: { kind: "n", value: Number(m[0]) } });
  }
  spans.sort((a, b) => a.at - b.at);
  let structure = "";
  let last = 0;
  for (const s of spans) {
    structure += norm.slice(last, s.at) + (s.token.kind === "d" ? "#d" : "#");
    last = s.end;
  }
  structure += norm.slice(last);
  return { structure, tokens: spans.map((s) => s.token) };
}

const pad = (n: number) => String(n).padStart(2, "0");
// A date as written ("1st april", "16 jan 27", "2027-01-16", "16/01"); without a year,
// the next time it comes round after today.
export function dateOf(raw: string, today: ISODate): ISODate | null {
  const s = raw.toLowerCase().trim();
  let y: number | null = null;
  let mo = 0;
  let d = 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}(?:,?\\s*(\\d{4}|\\d{2}))?$`)))) [d, mo, y] = [Number(m[1]), MONTHS[m[2]], m[3] ? Number(m[3]) : null];
  else if ((m = s.match(new RegExp(`^${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?$`)))) [mo, d, y] = [MONTHS[m[1]], Number(m[2]), m[3] ? Number(m[3]) : null];
  else if ((m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?$/))) [d, mo, y] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null];
  else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  let year = y ?? Number(today.slice(0, 4));
  if (year < 100) year += 2000;
  let iso = `${year}-${pad(mo)}-${pad(d)}`;
  if (new Date(iso + "T00:00:00Z").getUTCMonth() + 1 !== mo) return null;
  if (y === null && iso < today) iso = `${year + 1}-${pad(mo)}-${pad(d)}`;
  return iso;
}

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);

// ---------------------------------------------------------------- the memory

// A saved reading: the enquiry (normalised), its shape, its dates and numbers, and the
// trip that was quoted for it, in the JSON shape the AI answers in (so it goes through
// aiToParsed and is checked against master data again when it is used).
export interface ReadingPattern {
  id?: string;
  key: string;
  structure: string;
  tokens: Token[];
  reading: Record<string, unknown>;
  hits?: number;
}

// The pattern to store for a quote saved for the guest: what was typed, and the trip that
// was quoted (the sales person's corrections included).
export function patternFromPlan(enquiry: string, plan: Plan, ctx: BuilderContext, today: ISODate, rules: { phrase: string; meaning: string }[] = []): ReadingPattern | null {
  const key = normaliseEnquiry(enquiry, rules, [plan.guest.name]);
  if (key.length < 15 || !plan.stops.length) return null;
  const { structure, tokens } = structureOf(key, today);
  return { key, structure, tokens, reading: planReading(plan, ctx) };
}

// The trip as the AI would have answered it. Counts the sales person did not ask for
// (safaris "as many as fit") stay empty, so the planner works them out for the new dates.
export function planReading(plan: Plan, ctx: BuilderContext): Record<string, unknown> {
  const park = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? null;
  const lodge = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? null;
  const loc = (id: string | null) => (id ? ctx.locations.find((l) => l.id === id)?.name ?? null : null);
  const roomOf = (id: string) => ctx.rooms.find((r) => r.id === id)?.name ?? "";
  return {
    replace_route: true,
    adults: plan.guest.adults,
    children_ages: plan.guest.children,
    rooms: plan.guest.rooms,
    country: plan.guest.country || null,
    nationality: plan.guest.country ? null : plan.guest.nationality,
    arrival_date: plan.dateless ? null : plan.arrival_date,
    arrival_place: loc(plan.arrival_location_id),
    departure_place: loc(plan.departure_location_id),
    stops: plan.stops.map((s) => {
      const room = roomOf(s.room_category_id);
      return {
        park: park(s.park_id),
        lodge: lodge(s.property_id),
        room_name: room || null,
        room: /tree ?house/i.test(room) ? "tree" : /suite/i.test(room) ? "suite" : /deluxe room/i.test(room) ? "deluxe" : /cottage/i.test(room) ? "cottage" : null,
        nights: s.nights,
        safaris: s.want_safaris ?? null,
        naturalists: s.want_naturalists ?? null,
        extras: s.want_extras ?? [],
      };
    }),
    flights: (plan.flights ?? []).map((f) => ({ from: f.from, to: f.to, ...(f.time ? { time: f.time } : {}) })),
    city_stays: (plan.city_stays ?? []).filter((c) => !c.blank && c.city).map((c) => ({ when: c.when, city: c.city, nights: c.nights, ...(c.hotel ? { hotel: c.hotel } : {}), ...(c.at !== undefined ? { at: c.at } : {}) })),
    meal_plan: plan.stops[0]?.meal_plan ?? null,
  };
}

// A saved pattern used for a new enquiry: exactly the same text, or the same text with
// other dates and numbers. Each number written in the old enquiry is matched, by position,
// with the one written in the new enquiry ("3 nights" -> "4 nights"); dates move the trip
// by the same number of days. If one old number would have to become two different new
// numbers, it is not the same enquiry: null (the reader and the AI read it instead).
export function readFromPattern(p: ReadingPattern, tokens: Token[], today: ISODate): Record<string, unknown> | null {
  if (p.tokens.length !== tokens.length) return null;
  const nums = new Map<number, number>();
  let changed = false;
  let shift: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const o = p.tokens[i];
    const n = tokens[i];
    if (o.kind !== n.kind) return null;
    if (o.kind === "n" && n.kind === "n") {
      if (nums.has(o.value) && nums.get(o.value) !== n.value) return null;
      nums.set(o.value, n.value);
      if (o.value !== n.value) changed = true;
    } else if (o.kind === "d" && n.kind === "d") {
      const was = o.iso;
      const now = dateOf(n.raw, today);
      if (!was || !now) return null;
      const d = daysBetween(was, now);
      if (shift === null) shift = d;
      else if (shift !== d) changed = true; // two dates moved differently: the nights may differ, keep the numbers read
    }
  }
  // a number the old enquiry did not write (it was worked out) is left to the reader once numbers change
  const num = (v: unknown) => {
    if (typeof v !== "number") return v ?? null;
    if (nums.has(v)) return nums.get(v)!;
    return changed ? null : v;
  };
  const r = p.reading;
  const stops = (Array.isArray(r.stops) ? r.stops : []).map((s) => {
    const x = s as Record<string, unknown>;
    return { ...x, nights: num(x.nights), safaris: num(x.safaris), naturalists: x.naturalists === -1 ? -1 : num(x.naturalists) };
  });
  const stays = (Array.isArray(r.city_stays) ? r.city_stays : []).map((c) => ({ ...(c as Record<string, unknown>), nights: num((c as Record<string, unknown>).nights) }));
  const arrival = typeof r.arrival_date === "string" && shift !== null ? addDays(r.arrival_date, shift) : null;
  return {
    ...r,
    adults: num(r.adults),
    rooms: num(r.rooms),
    children_ages: (Array.isArray(r.children_ages) ? r.children_ages : []).map(num).filter((a) => typeof a === "number"),
    arrival_date: arrival,
    stops,
    city_stays: stays,
  };
}

// The best saved pattern for an enquiry: the exact text first, then the same shape;
// among several, the one used most.
export function pickPattern(rows: ReadingPattern[], key: string, tokens: Token[], today: ISODate): { pattern: ReadingPattern; reading: Record<string, unknown>; exact: boolean } | null {
  const sorted = [...rows].sort((a, b) => (a.key === key ? 0 : 1) - (b.key === key ? 0 : 1) || (b.hits ?? 0) - (a.hits ?? 0));
  for (const p of sorted) {
    const reading = readFromPattern(p, tokens, today);
    if (reading) return { pattern: p, reading, exact: p.key === key };
  }
  return null;
}

// ---------------------------------------------------------------- when the AI is asked

// Every message goes to the AI first (when it is switched on), except a short reply to the
// assistant's own question ("cottage", "same", "7 and 12", "3"): those are the reader's.
export function isShortAnswer(text: string, pending: string | null | undefined): boolean {
  return !!pending && pending !== "parks" && text.trim().length <= 30;
}

// ---------------------------------------------------------------- merging

// A reading from memory comes first (it is the quote the sales person checked); the
// reader fills what the memory does not keep (contacts, transport words, requests...).
export function mergeMemory(mem: ParsedTrip, rule: ParsedTrip): ParsedTrip {
  const parks = mem.parks.length
    ? mem.parks.map((p, i) => {
        const r = rule.parks[i]?.name === p.name ? rule.parks[i] : undefined;
        return { ...r, ...defined(p), name: p.name } as ParsedPark;
      })
    : rule.parks;
  return {
    ...rule,
    adults: mem.adults ?? rule.adults,
    children: mem.children?.length ? mem.children : rule.children,
    rooms: mem.rooms ?? rule.rooms,
    nationality: mem.nationality ?? rule.nationality,
    country: mem.country ?? rule.country,
    arrival_date: mem.arrival_date ?? rule.arrival_date,
    arrival_place: mem.arrival_place ?? rule.arrival_place,
    departure_place: mem.departure_place ?? rule.departure_place,
    parks,
    meal_plan: mem.meal_plan ?? rule.meal_plan,
    flights: mem.flights?.length ? mem.flights : rule.flights,
    cityStays: mem.cityStays?.length ? mem.cityStays : rule.cityStays,
    replaceRoute: mem.parks.length > 0 || rule.replaceRoute,
    asks: [...(rule.asks ?? []), ...(mem.asks ?? [])],
    // the memory's lodge was checked by a person: the reader's "assumed" notes about it do not apply
    notes: rule.notes.filter((n) => !(mem.departure_place && n.startsWith("Assumed the guest also leaves"))),
  };
}

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as Partial<T>;
}

// What the built-in reader added to the AI's reading, in words for the chat.
export type Filled = "guests" | "nationality" | "dates" | "arrival" | "departure" | "route" | "nights" | "lodge" | "room" | "safaris" | "experiences" | "flights" | "city nights" | "meal plan" | "transport" | "requests";

const FIELD_WORD: Partial<Record<keyof ParsedTrip, Filled>> = {
  adults: "guests",
  children: "guests",
  rooms: "guests",
  nationality: "nationality",
  country: "nationality",
  arrival_date: "dates",
  departure_date: "dates",
  arrival_place: "arrival",
  departure_place: "departure",
  meal_plan: "meal plan",
  arrival_mode: "transport",
  departure_mode: "transport",
  between: "transport",
  own_all: "transport",
  requests: "requests",
  flights: "flights",
  cityStays: "city nights",
};
const PARK_WORD: Partial<Record<keyof ParsedPark, Filled>> = { nights: "nights", lodge: "lodge", room: "room", roomName: "room", safaris: "safaris", naturalists: "safaris", extras: "experiences" };

const empty = (v: unknown) => v === undefined || v === null || (Array.isArray(v) && v.length === 0);
// the list holds every item of the other, in the same order, and more
const holdsInOrder = (big: string[], small: string[]) => {
  let i = 0;
  for (const x of big) if (i < small.length && x.toLowerCase() === small[i].toLowerCase()) i++;
  return i === small.length && big.length > small.length;
};

// AI first. The AI's reading (already through the evidence rule, evidence.ts, and checked
// against Master data, aiToParsed) is the reading. The built-in reader only fills what the AI
// left empty: a field, a detail of a stop, a stop or a flight the AI gave no quote for. It
// never overrides a value the AI quoted from the message. There is no "I read X, the AI read
// Y" question: what is missing or genuinely unclear is asked by the checklist, in plain words.
export function mergeAiFirst(ai: ParsedTrip, rule: ParsedTrip): { parsed: ParsedTrip; fromReader: Filled[] } {
  const added = new Set<Filled>();
  const out: ParsedTrip = { ...ai, parks: ai.parks.map((p) => ({ ...p })) };
  const o = out as unknown as Record<string, unknown>;

  // ---- every field the AI left empty, from the reader
  for (const [k, v] of Object.entries(rule) as [keyof ParsedTrip, unknown][]) {
    if (k === "parks" || k === "flights" || k === "cityStays" || k === "asks" || k === "notes") continue;
    if (empty(o[k]) && !empty(v) && !(k === "replaceRoute" && v === false)) {
      o[k] = v;
      const w = FIELD_WORD[k];
      if (w) added.add(w);
    }
  }

  // ---- the stops: the AI's, each detail it left empty from the reader's same stop. Stops the
  // AI gave no quote for (it named fewer, in the same order) come from the reader.
  const fillStop = (a: ParsedPark, r: ParsedPark | undefined): ParsedPark => {
    if (!r) return a;
    const p = { ...a } as Record<string, unknown>;
    // experiences: both lists (the AI only knows the shared keywords; the reader also reads each
    // add-on's own name from Master data: "tawa cruise...", "moharli gate entry", "boat safari 1 hour"),
    // the more specific kept ("boat safari 1 hour" over "boat safari", "half day fishing" over "fishing")
    if (a.extras?.length && r.extras?.length) {
      const all = [...new Set([...r.extras, ...a.extras])];
      const words = (x: string) => x.split(/\s+/);
      const kept = all.filter((x) => !all.some((y) => y !== x && words(x).every((w) => words(y).includes(w))));
      if (kept.some((x) => !a.extras!.includes(x))) added.add("experiences");
      p.extras = kept;
    }
    for (const [k, v] of Object.entries(r)) {
      if (empty(p[k]) && !empty(v)) {
        p[k] = v;
        const w = PARK_WORD[k as keyof ParsedPark];
        if (w) added.add(w);
      }
    }
    return p as unknown as ParsedPark;
  };
  if (!ai.parks.length) {
    out.parks = rule.parks;
    if (rule.parks.length) added.add("route");
  } else {
    const sameNames = (ps: ParsedPark[]) => ps.map((p) => p.name);
    if (holdsInOrder(sameNames(rule.parks), sameNames(ai.parks))) {
      // the reader found every stop the AI quoted, and more: the reader's list, the AI's details first
      let i = 0;
      out.parks = rule.parks.map((r) => {
        if (i < ai.parks.length && ai.parks[i].name === r.name) return fillStop(ai.parks[i++], r);
        added.add("route");
        return r;
      });
    } else {
      // the AI's stops; each matched with the reader's stop of the same park (in turn)
      const used = new Set<number>();
      out.parks = ai.parks.map((a) => {
        const j = rule.parks.findIndex((r, k) => !used.has(k) && r.name === a.name && (!a.lodge || !r.lodge || r.lodge === a.lodge));
        if (j >= 0) used.add(j);
        return fillStop(a, j >= 0 ? rule.parks[j] : undefined);
      });
    }
  }

  // the same lodge twice in a row from the AI where the reader read two lodges of the park
  // ("2 nights kings 2 nights tree house"): the reader's lodge (3 Nov 2026)
  out.parks = out.parks.map((p, k) => {
    const prev = out.parks[k - 1];
    const r = rule.parks[k];
    return prev && p.lodge && prev.name === p.name && prev.lodge === p.lodge && r?.name === p.name && r.lodge && r.lodge !== p.lodge ? { ...p, lodge: r.lodge } : p;
  });

  // ---- flights and city nights: the AI's list; the reader's when it holds all of them and more
  const legs = (f: ParsedTrip["flights"]) => (f ?? []).map((x) => `${x.from}>${x.to}`);
  if (empty(ai.flights) && !empty(rule.flights)) {
    out.flights = rule.flights;
    added.add("flights");
  } else if (!empty(rule.flights) && holdsInOrder(legs(rule.flights), legs(ai.flights))) {
    out.flights = rule.flights;
    added.add("flights");
  }
  const stays = (c: ParsedTrip["cityStays"]) => (c ?? []).map((x) => `${x.city}`);
  if (empty(ai.cityStays) && !empty(rule.cityStays)) {
    out.cityStays = rule.cityStays;
    added.add("city nights");
  } else if (!empty(rule.cityStays) && holdsInOrder(stays(rule.cityStays), stays(ai.cityStays))) {
    // the reader's list (it knows where each night sits); the AI's hotel for the night it named,
    // matched in order (each AI night once)
    const left = [...(ai.cityStays ?? [])];
    out.cityStays = rule.cityStays!.map((r) => {
      const k = left.findIndex((x) => x.city.toLowerCase() === r.city.toLowerCase() && x.nights === r.nights);
      const a = k >= 0 ? left.splice(k, 1)[0] : undefined;
      return a?.hotel && !r.hotel ? { ...r, hotel: a.hotel } : r;
    });
    added.add("city nights");
  } else if (!empty(ai.cityStays) && !empty(rule.cityStays)) {
    // the same nights in both: the reader's positions between the lodges, the AI's hotels
    out.cityStays = ai.cityStays!.map((a, k) => {
      const r = rule.cityStays![k];
      return r && r.city.toLowerCase() === a.city.toLowerCase() ? { ...a, at: a.at ?? r.at, hotel: a.hotel ?? r.hotel, want_extras: r.want_extras } : a;
    });
  }

  // ---- nights not with us (a break from our itinerary): read by the reader only; never lost
  const awayOf = (c: ParsedTrip["cityStays"]) => (c ?? []).filter((x) => x.away);
  if (awayOf(rule.cityStays).length && !awayOf(out.cityStays).length) {
    out.cityStays = [...(out.cityStays ?? []), ...awayOf(rule.cityStays)];
    added.add("city nights");
  }

  // ---- the trip date is the day they reach the first lodge. "20 Apr 2027 1 night Delhi": an AI
  // that gives the day they land in Delhi is the same trip as the reader's 21 Apr (that day plus
  // the city nights before the first lodge): the lodge day is kept.
  const lead = (out.cityStays ?? []).filter((c) => c.when === "before" && !c.at).reduce((t, c) => t + c.nights, 0);
  if (ai.arrival_date && rule.arrival_date && lead > 0 && addDays(ai.arrival_date, lead) === rule.arrival_date) out.arrival_date = rule.arrival_date;

  // ---- what is unclear (names not in Master data, the reader's own questions), and its notes.
  // A question of the reader that the AI's quoted values answer is not asked ("How old are the
  // children?" when the message says "7 aur 12 saal" and the AI quoted it).
  const answered = (key: string) =>
    (key === "ages" && !empty(ai.children)) ||
    (key === "date" && !!ai.arrival_date) ||
    (key === "flight-time" && (ai.flights ?? []).some((f) => !!f.time));
  const asks: Ask[] = [];
  for (const a of [...(rule.asks ?? []), ...(ai.asks ?? [])]) if (!asks.some((x) => x.key === a.key) && !answered(a.key)) asks.push(a);
  out.asks = asks;
  out.notes = rule.notes;
  return { parsed: out, fromReader: [...added] };
}

// Where the reading came from, shown small under the assistant's reply.
export function sourceNote(source: "memory" | "reader" | "ai", fromReader: Filled[] = []): string {
  if (source === "memory") return "from memory";
  if (source === "ai") return fromReader.length ? `read by the AI; the built-in reader added: ${fromReader.join(", ")}` : "read by the AI";
  return "built-in reader";
}
