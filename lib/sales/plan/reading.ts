// =====================================================================
// One reading flow for the trip assistant, so the reader and the AI never disagree:
//   1. memory   - a saved reading of the same enquiry (or the same enquiry with only
//                 dates, numbers or names changed): used as it is, no AI call
//   2. reader   - the built-in reader (parse-text.ts) fills the trip checklist
//   3. AI       - only for what is still missing, and only when the message has words
//                 the reader could not place. The AI may fill empty fields; it never
//                 overrides the reader. Where they disagree, the sales person is asked.
// Everything from memory or the AI goes through aiToParsed (checked against master data).
// Pure, so it is tested without a database or the network.
// =====================================================================

import type { ISODate } from "@/lib/sales/pricing/types";
import { addDays } from "@/lib/sales/pricing/dates";
import { countryName } from "@/lib/sales/countries";
import { fmtDate } from "@/lib/sales/format";
import { applyRules, aliasesOf, scrubForAI, type Ask, type ParsedPark, type ParsedTrip } from "./parse-text";
import type { BuilderContext, Plan } from "./types";
import type { CheckItem } from "./checklist";

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

// ---------------------------------------------------------------- when the AI helps

// The AI is asked only when the checklist still has open questions AND the message has
// words the reader could not place (or the reader found no trip at all). When every word
// was read and something is still missing, it was not in the message: the sales person
// is asked, and the AI would only guess.
export function aiShouldHelp(input: { gaps: readonly unknown[]; unknownWords: string[]; stops: number }): boolean {
  if (!input.gaps.length) return false;
  return input.unknownWords.length > 0 || input.stops === 0;
}

// The checklist questions still open, as told to the AI ("Stop 1: Bandhavgarh: how many nights?").
export const gapsOf = (checklist: CheckItem[] | undefined) => (checklist ?? []).filter((c) => !c.ok);
export const gapText = (gaps: CheckItem[]) => gaps.map((g) => `${g.label}: ${g.text}`).slice(0, 12);

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

// What the AI filled, in words for the chat ("AI helped with: dates, nights").
export type Filled = "guests" | "nationality" | "dates" | "arrival" | "departure" | "route" | "nights" | "lodge" | "room" | "safaris" | "experiences" | "flights" | "city nights" | "meal plan";

// The AI fills only what the reader left empty. Where both read something and it differs,
// the reader's value stays in the plan and the sales person gets one clear question (with
// both answers as one-click replies), asked before the price. Nothing is picked silently.
export function fillGaps(rule: ParsedTrip, ai: ParsedTrip): { parsed: ParsedTrip; filled: Filled[]; asks: Ask[] } {
  const out: ParsedTrip = { ...rule, parks: rule.parks.map((p) => ({ ...p })) };
  const filled = new Set<Filled>();
  const asks: Ask[] = [];
  const ask = (key: string, text: string, quick: string[]) => asks.push({ key: `conflict:${key}`, text, quick: [...new Set(quick)] });
  const short = (park: string) => {
    const a = aliasesOf(park).filter((x) => !x.includes(" ")).sort((x, y) => x.length - y.length)[0] ?? park;
    return a.charAt(0).toUpperCase() + a.slice(1);
  };
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // ---- guests
  if (rule.adults === undefined && ai.adults !== undefined) { out.adults = ai.adults; filled.add("guests"); }
  else if (rule.adults !== undefined && ai.adults !== undefined && ai.adults !== rule.adults)
    ask("adults", `I read ${plural(rule.adults, "adult")}, the AI read ${ai.adults}. How many adults?`, [plural(rule.adults, "adult"), plural(ai.adults, "adult")]);
  if (!rule.children?.length && ai.children?.length) { out.children = ai.children; filled.add("guests"); }
  else if (rule.children?.length && ai.children?.length && rule.children.join() !== ai.children.join())
    ask("children", `I read children aged ${rule.children.join(", ")}, the AI read ${ai.children.join(", ")}. Which is right?`, [
      `${rule.children.length} ${rule.children.length === 1 ? "child" : "children"} aged ${rule.children.join(" and ")}`,
      `${ai.children.length} ${ai.children.length === 1 ? "child" : "children"} aged ${ai.children.join(" and ")}`,
    ]);
  if (rule.rooms === undefined && ai.rooms !== undefined) { out.rooms = ai.rooms; filled.add("guests"); }
  else if (rule.rooms !== undefined && ai.rooms !== undefined && ai.rooms !== rule.rooms)
    ask("rooms", `I read ${plural(rule.rooms, "room")}, the AI read ${ai.rooms}. How many rooms?`, [plural(rule.rooms, "room"), plural(ai.rooms, "room")]);

  // ---- nationality
  const nat = (p: ParsedTrip) => p.country ?? p.nationality;
  if (nat(rule) === undefined && nat(ai) !== undefined) {
    out.country = ai.country;
    out.nationality = ai.nationality;
    filled.add("nationality");
  } else if (rule.country && ai.country && rule.country !== ai.country) {
    const say = (c: string) => (c === "IN" ? "Indian guests" : `from ${countryName(c) || c}`);
    ask("country", `I read the guests as ${countryName(rule.country) || rule.country}, the AI as ${countryName(ai.country) || ai.country}. Which is right?`, [say(rule.country), say(ai.country)]);
  } else if (!rule.country && !ai.country && rule.nationality && ai.nationality && rule.nationality !== ai.nationality) {
    ask("nationality", `I read the guests as ${rule.nationality}, the AI as ${ai.nationality}. Which is right?`, [`${rule.nationality} guests`, `${ai.nationality} guests`]);
  }

  // ---- date
  if (!rule.arrival_date && ai.arrival_date) { out.arrival_date = ai.arrival_date; filled.add("dates"); }
  else if (rule.arrival_date && ai.arrival_date && rule.arrival_date !== ai.arrival_date)
    ask("date", `I read the arrival as ${fmtDate(rule.arrival_date)}, the AI as ${fmtDate(ai.arrival_date)}. When do they arrive?`, [`arriving ${fmtDate(rule.arrival_date)}`, `arriving ${fmtDate(ai.arrival_date)}`]);

  // ---- the way in and out
  // The arrival place is where our car picks them up for the safari part (after any flight).
  // With a city night before the first lodge and a flight out of that city ("1 night Delhi,
  // fly to Jabalpur"), an AI that names the city (or its airport) as the arrival means the
  // same trip: not a disagreement, and not a place to fill in. The same for the way out.
  const cityNights = rule.cityStays?.length ? rule.cityStays : ai.cityStays ?? [];
  const flown = rule.flights?.length ? rule.flights : ai.flights ?? [];
  const lodges = rule.parks.length || ai.parks.length;
  const inCity = (place: string, city: string) => place.toLowerCase().includes(city.toLowerCase().trim());
  const flyInCity = (place: string) =>
    cityNights.some((c) => c.when === "before" && !c.at && !!c.city && inCity(place, c.city) && flown.some((f) => inCity(f.from, c.city)));
  const flyOutCity = (place: string) =>
    cityNights.some((c) => c.when === "after" && (c.at === undefined || c.at >= lodges) && !!c.city && inCity(place, c.city) && flown.some((f) => inCity(f.to, c.city)));
  if (!rule.arrival_place && ai.arrival_place && !flyInCity(ai.arrival_place)) { out.arrival_place = ai.arrival_place; filled.add("arrival"); }
  else if (rule.arrival_place && ai.arrival_place && rule.arrival_place !== ai.arrival_place && !flyInCity(ai.arrival_place))
    ask("arrival", `Where does our car pick them up for the safari part? I read ${rule.arrival_place}, the AI read ${ai.arrival_place}.`, [`arrive at ${rule.arrival_place}`, `arrive at ${ai.arrival_place}`]);
  if (!rule.departure_place && ai.departure_place && !flyOutCity(ai.departure_place)) { out.departure_place = ai.departure_place; filled.add("departure"); }
  else if (rule.departure_place && ai.departure_place && rule.departure_place !== ai.departure_place && !flyOutCity(ai.departure_place))
    ask("departure", `I read the departure from ${rule.departure_place}, the AI from ${ai.departure_place}. Where do they leave from?`, [`leave from ${rule.departure_place}`, `leave from ${ai.departure_place}`]);

  // ---- the route
  if (!rule.parks.length && ai.parks.length) {
    out.parks = ai.parks;
    filled.add("route");
  } else if (rule.parks.length && ai.parks.length) {
    const seq = (ps: ParsedPark[]) => ps.map((p) => p.name).join(">");
    if (seq(rule.parks) !== seq(ai.parks)) {
      const said = (ps: ParsedPark[]) => ps.map((p) => `${short(p.name)}${p.nights ? ` ${p.nights}n` : ""}`).join(", ");
      ask("route", `I read the route as ${said(rule.parks)}; the AI read ${said(ai.parks)}. I kept mine: is it right? If not, type the route again.`, ["Keep this route"]);
    } else {
      out.parks = rule.parks.map((r, i) => {
        const a = ai.parks[i];
        const p = { ...r };
        const name = short(r.name);
        if (r.nights === undefined && a.nights !== undefined) { p.nights = a.nights; filled.add("nights"); }
        else if (r.nights !== undefined && a.nights !== undefined && r.nights !== a.nights)
          ask(`nights:${i}`, `${name}: I read ${plural(r.nights, "night")}, the AI read ${a.nights}. How many nights?`, [`make ${name} ${plural(r.nights, "night")}`, `make ${name} ${plural(a.nights, "night")}`]);
        if (!r.lodge && a.lodge) { p.lodge = a.lodge; filled.add("lodge"); }
        else if (r.lodge && a.lodge && r.lodge !== a.lodge)
          ask(`lodge:${i}`, `${name}: I read ${r.lodge}, the AI read ${a.lodge}. Which lodge?`, [`${name} at ${r.lodge}`, `${name} at ${a.lodge}`]);
        if (!r.room && !r.roomName && a.room) { p.room = a.room; filled.add("room"); }
        if (r.safaris === undefined && a.safaris !== undefined) { p.safaris = a.safaris; filled.add("safaris"); }
        else if (r.safaris !== undefined && a.safaris !== undefined && r.safaris !== a.safaris)
          ask(`safaris:${i}`, `${name}: I read ${plural(r.safaris, "safari")}, the AI read ${a.safaris}. How many safaris?`, [`${name} ${plural(r.safaris, "safari")}`, `${name} ${plural(a.safaris, "safari")}`]);
        if (r.naturalists === undefined && a.naturalists !== undefined) { p.naturalists = a.naturalists; filled.add("safaris"); }
        if (!r.extras?.length && a.extras?.length) { p.extras = a.extras; filled.add("experiences"); }
        return p;
      });
    }
  }
  // edits only the AI understood ("pench pehle karo"): taken when the reader read none
  if (!rule.order?.length && ai.order?.length) { out.order = ai.order; filled.add("route"); }
  if (!rule.removeParks?.length && ai.removeParks?.length) { out.removeParks = ai.removeParks; filled.add("route"); }
  if (rule.reverse === undefined && ai.reverse) { out.reverse = true; filled.add("route"); }
  // "new plan: ...": a whole new route, when the AI's stops are the ones the reader read too
  if (!rule.replaceRoute && ai.replaceRoute && out.parks.length && !asks.some((a) => a.key === "conflict:route")) {
    out.replaceRoute = true;
    filled.add("route");
  }

  // ---- flights and city nights
  const legs = (f: ParsedTrip["flights"]) => (f ?? []).map((x) => `${x.from}>${x.to}`).join(", ");
  if (!rule.flights?.length && ai.flights?.length) { out.flights = ai.flights; filled.add("flights"); }
  else if (rule.flights?.length && ai.flights?.length && legs(rule.flights).toLowerCase() !== legs(ai.flights).toLowerCase())
    ask("flights", `I read the flights as ${legs(rule.flights).replace(/>/g, " to ")}; the AI read ${legs(ai.flights).replace(/>/g, " to ")}. I kept mine: are they right?`, ["Keep these flights"]);
  const stays = (c: ParsedTrip["cityStays"]) => (c ?? []).map((x) => `${x.city} ${x.nights}`).join(", ");
  if (!rule.cityStays?.length && ai.cityStays?.length) { out.cityStays = ai.cityStays; filled.add("city nights"); }
  else if (rule.cityStays?.length && ai.cityStays?.length && stays(rule.cityStays).toLowerCase() !== stays(ai.cityStays).toLowerCase())
    ask("city", `I read the city nights as ${stays(rule.cityStays)}; the AI read ${stays(ai.cityStays)}. I kept mine: are they right?`, ["Keep these city nights"]);

  if (!rule.meal_plan && ai.meal_plan) { out.meal_plan = ai.meal_plan; filled.add("meal plan"); }

  // names the AI gave that are not in master data (dropped by aiToParsed): asked, never guessed
  for (const a of ai.asks ?? []) if (!asks.some((x) => x.key === a.key)) asks.push(a);

  out.asks = [...(rule.asks ?? []), ...asks];
  return { parsed: out, filled: [...filled], asks };
}

// Where the reading came from, shown small under the assistant's reply.
export function sourceNote(source: "memory" | "reader" | "ai", filled: Filled[] = []): string {
  if (source === "memory") return "from memory";
  if (source === "ai" && filled.length) return `AI helped with: ${filled.join(", ")}`;
  return "built-in reader";
}

// Which reading a message gets: memory when a saved pattern matches (no AI call, even with
// gaps), the AI when it may help (above) and is switched on, otherwise the reader alone.
export function chooseSource(input: { memoryHit: boolean; aiOn: boolean; gaps: CheckItem[]; unknownWords: string[]; stops: number }): "memory" | "ai" | "reader" {
  if (input.memoryHit) return "memory";
  if (input.aiOn && aiShouldHelp(input)) return "ai";
  return "reader";
}
