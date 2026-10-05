// =====================================================================
// Reads a trip description written by a sales member, e.g.
//   "2 adults, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then
//    Pench 3 nights, Nagpur out, full board"
// and turns it into plan fields. Two stages:
//   extractTrip()  text -> ParsedTrip (names, numbers, dates)   [rules, free]
//   applyParsed()  ParsedTrip -> Plan (ids from master data)
// A Gemini result (optional fallback) uses the same ParsedTrip shape, so
// both go through the same applyParsed().
// =====================================================================

import type { ISODate } from "@/lib/sales/pricing/types";
import { defaultStop, mealPlansOf, roomsOf } from "./planner";
import type { BuilderContext, Plan } from "./types";

export interface ParsedTrip {
  adults?: number;
  children?: number[]; // ages
  rooms?: number;
  nationality?: "indian" | "foreign";
  arrival_date?: ISODate;
  departure_date?: ISODate;
  arrival_place?: string;
  departure_place?: string;
  parks: { name: string; nights?: number; lodge?: string }[];
  meal_plan?: "AP" | "MAP" | "CP" | "EP";
  notes: string[]; // assumptions made while reading
}

// ---------------------------------------------------------------- helpers

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  a: 1, an: 1, single: 1, couple: 2, pair: 2,
};
const NUM = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()] ?? NaN);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pad = (n: number) => String(n).padStart(2, "0");

function makeDate(y: number | null, m: number, d: number, today: ISODate): ISODate | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  let year = y ?? Number(today.slice(0, 4));
  if (year < 100) year += 2000;
  let iso = `${year}-${pad(m)}-${pad(d)}`;
  const check = new Date(iso + "T00:00:00Z");
  if (check.getUTCMonth() + 1 !== m) return null; // e.g. 31 Feb
  if (y === null && iso < today) iso = `${year + 1}-${pad(m)}-${pad(d)}`; // no year: next time it comes round
  return iso;
}

function nightsBetween(a: ISODate, b: ISODate) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

// Short names people actually type: "Tadoba-Andhari Tiger Reserve" -> tadoba, andhari...
const FILLER = /\b(national park|tiger reserve|wildlife sanctuary|sanctuary|reserve|forest|np|the)\b/g;
export function aliasesOf(name: string): string[] {
  const full = name.toLowerCase().trim();
  const core = full.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  const parts = core.split(/[\s\-/]+/).filter((w) => w.length >= 4);
  return [...new Set([full, core, ...parts].filter((x) => x.length >= 3))];
}
function locationAliases(name: string, code?: string | null): string[] {
  const full = name.toLowerCase().trim();
  const core = full.replace(/\b(international|domestic|airport|railway station|railway|station|junction|jn|city|bus stand)\b/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set([full, core, ...(code ? [code.toLowerCase()] : [])].filter((x) => x.length >= 3))];
}

interface Hit {
  index: number;
  end: number;
  name: string;
}
function findAll(text: string, items: { name: string; aliases: string[] }[]): Hit[] {
  const hits: Hit[] = [];
  for (const it of items) {
    for (const a of it.aliases.sort((x, y) => y.length - x.length)) {
      const re = new RegExp(`\\b${escapeRe(a)}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!hits.some((h) => m!.index < h.end && m!.index + m![0].length > h.index)) {
          hits.push({ index: m.index, end: m.index + m[0].length, name: it.name });
        }
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------- extract

export function extractTrip(input: string, ctx: BuilderContext, today: ISODate): ParsedTrip {
  const text = input.replace(/\s+/g, " ").trim();
  const low = text.toLowerCase();
  const out: ParsedTrip = { parks: [], notes: [] };

  // ---- guests
  const adultsM = low.match(new RegExp(`\\b${NUM}\\s*(?:adults?|pax|people|persons|guests|travell?ers|ppl)\\b`));
  const familyM = low.match(new RegExp(`\\bfamily of\\s*${NUM}\\b`));
  const kidsM = low.match(new RegExp(`\\b${NUM}\\s*(?:kids?|children|childs?|child)\\b`));
  const agesM = low.match(/\b(?:aged?|ages?)\s*:?\s*(\d{1,2}(?:\s*(?:,|and|&|\/)\s*\d{1,2})*)/);

  let ages: number[] = agesM ? agesM[1].split(/\s*(?:,|and|&|\/)\s*/).map(Number).filter((n) => n >= 0 && n < 18) : [];
  const kidCount = kidsM ? toNum(kidsM[1]) : ages.length;
  if (kidCount > 0) {
    if (ages.length !== kidCount) {
      if (ages.length > kidCount) ages = ages.slice(0, kidCount);
      else {
        out.notes.push(`Children's ages not given; assumed 10.`);
        ages = [...ages, ...Array(kidCount - ages.length).fill(10)];
      }
    }
    out.children = ages;
  }

  if (adultsM) out.adults = toNum(adultsM[1]);
  else if (familyM) out.adults = Math.max(1, toNum(familyM[1]) - (out.children?.length ?? 0));
  else if (/\bcouple\b/.test(low)) out.adults = 2;
  else if (/\b(solo|single traveller|single traveler)\b/.test(low)) out.adults = 1;

  const roomsM = low.match(new RegExp(`\\b${NUM}\\s*(?:rooms?|cottages?|tents?|suites?|villas?|tree ?houses?)\\b`));
  if (roomsM) out.rooms = toNum(roomsM[1]);

  if (/\b(indian|domestic|resident)s?\b/.test(low)) out.nationality = "indian";
  else if (/\b(foreign(?:er|ers)?|international|overseas|nri)\b/.test(low)) out.nationality = "foreign";

  if (/\b(full board|all meals|\bap\b|american plan)/.test(low)) out.meal_plan = "AP";
  else if (/\b(map|half board|breakfast and dinner|modified american)\b/.test(low)) out.meal_plan = "MAP";
  else if (/\b(cp|bed and breakfast|b&b|breakfast only|continental plan)\b/.test(low)) out.meal_plan = "CP";
  else if (/\b(ep|room only|european plan)\b/.test(low)) out.meal_plan = "EP";

  // ---- dates (first date found = arrival; a range also gives departure)
  const range = low.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|till|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s*(\\d{4})?`));
  const candidates: { at: number; date: ISODate }[] = [];
  const push = (at: number, d: ISODate | null) => d && candidates.push({ at, date: d });
  if (range) {
    const m = MONTHS[range[3]] ?? MONTHS[range[3].slice(0, 3)];
    const y = range[4] ? Number(range[4]) : null;
    const a = makeDate(y, m, Number(range[1]), today);
    const b = a ? makeDate(Number(a.slice(0, 4)), m, Number(range[2]), a) : null;
    if (a && b && b > a) {
      out.arrival_date = a;
      out.departure_date = b;
    }
  }
  if (!out.arrival_date) {
    let m: RegExpExecArray | null;
    const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = iso.exec(low))) push(m.index, makeDate(Number(m[1]), Number(m[2]), Number(m[3]), today));
    const dmy = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g; // Indian order: day first
    while ((m = dmy.exec(low))) push(m.index, makeDate(Number(m[3]), Number(m[2]), Number(m[1]), today));
    const dMon = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s*(\\d{4})?`, "g");
    while ((m = dMon.exec(low))) push(m.index, makeDate(m[3] ? Number(m[3]) : null, MONTHS[m[2]] ?? MONTHS[m[2].slice(0, 3)], Number(m[1]), today));
    const monD = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?\\s*(\\d{4})?`, "g");
    while ((m = monD.exec(low))) push(m.index, makeDate(m[3] ? Number(m[3]) : null, MONTHS[m[1]] ?? MONTHS[m[1].slice(0, 3)], Number(m[2]), today));
    candidates.sort((a, b) => a.at - b.at);
    if (candidates[0]) out.arrival_date = candidates[0].date;
    if (candidates[1] && candidates[1].date > candidates[0].date) out.departure_date = candidates[1].date;
  }

  // ---- parks with nights, in the order written
  // Adjacent mentions of the same park ("tadoba andhari") count as one.
  const parkHits = findAll(text, ctx.pricing.parks.map((p) => ({ name: p.name, aliases: aliasesOf(p.name) }))).reduce<Hit[]>((acc, h) => {
    const last = acc[acc.length - 1];
    if (last && last.name === h.name && /^[\s\-/]*$/.test(text.slice(last.end, h.index))) last.end = h.end;
    else acc.push({ ...h });
    return acc;
  }, []);
  // Each night count ("4 nights", "4N", "x4") belongs to the park right after
  // it ("4N Kanha") or right before it ("Kanha 4 nights"). Lodge names in
  // between are ignored ("3 nights at Kings Lodge in Bandhavgarh"). When a
  // count could go either way, the writer's usual style decides.
  const lodgeAliasList = ctx.properties.map((p) => p.name.toLowerCase());
  const gapIsGlue = (gap: string) => {
    let g = gap.toLowerCase();
    for (const a of lodgeAliasList) g = g.split(a).join(" ");
    return /^[\s\W]*(?:(?:in|at|@|of|for|stay(?:ing)?)[\s\W]+)*$/.test(g + " ");
  };
  const tokens: { start: number; end: number; value: number; before?: number; after?: number }[] = [];
  const tokRe = new RegExp(`(?:\\bx\\s*${NUM}\\b|\\b${NUM}\\s*(?:n|nts?|nights?)\\b)`, "gi");
  let tm: RegExpExecArray | null;
  while ((tm = tokRe.exec(text))) {
    const value = toNum(tm[1] ?? tm[2]);
    if (!Number.isFinite(value)) continue;
    const t = { start: tm.index, end: tm.index + tm[0].length, value } as (typeof tokens)[number];
    const nextPark = parkHits.findIndex((h) => h.index >= t.end);
    if (nextPark >= 0 && parkHits[nextPark].index - t.end <= 40 && gapIsGlue(text.slice(t.end, parkHits[nextPark].index))) t.before = nextPark;
    const prevPark = parkHits.map((h, i) => [h, i] as const).filter(([h]) => h.end <= t.start).pop();
    if (prevPark && t.start - prevPark[0].end <= 12 && /^[\s\-:,(]*(?:for\s*)?$/i.test(text.slice(prevPark[0].end, t.start))) t.after = prevPark[1];
    tokens.push(t);
  }
  const prefixStyle = tokens.filter((t) => t.before !== undefined && t.after === undefined).length;
  const suffixStyle = tokens.filter((t) => t.after !== undefined && t.before === undefined).length;
  const nightsFor = new Map<number, number>();
  for (const t of tokens) {
    let target = t.before ?? t.after;
    if (t.before !== undefined && t.after !== undefined) target = prefixStyle > suffixStyle ? t.before : t.after;
    if (target !== undefined && !nightsFor.has(target)) nightsFor.set(target, t.value);
  }
  parkHits.forEach((h) => {
    if (out.parks.some((p) => p.name === h.name)) return; // mentioned twice: keep the first position
    const nights = parkHits.map((x, i) => (x.name === h.name ? nightsFor.get(i) : undefined)).find((n) => n !== undefined);
    out.parks.push({ name: h.name, nights });
  });

  if (out.parks.length === 1 && !out.parks[0].nights && out.arrival_date && out.departure_date) {
    out.parks[0].nights = nightsBetween(out.arrival_date, out.departure_date);
  }

  // ---- lodges mentioned by name
  const lodgeHits = findAll(text, ctx.properties.map((p) => ({ name: p.name, aliases: [p.name.toLowerCase()] })));
  for (const l of lodgeHits) {
    const prop = ctx.properties.find((p) => p.name === l.name);
    const parkName = ctx.pricing.parks.find((p) => p.id === prop?.park_id)?.name;
    const stop = out.parks.find((p) => p.name === parkName);
    if (stop) stop.lodge = l.name;
    else if (parkName) out.parks.push({ name: parkName, lodge: l.name });
  }

  // ---- arrival / departure places
  // Airports first, so "Nagpur" means the airport when a station has the same city name.
  const rank: Record<string, number> = { airport: 0, railway: 1, city: 2, other: 3 };
  const places = ctx.locations.filter((l) => l.type !== "property").sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  const placeHits = findAll(text, places.map((l) => ({ name: l.name, aliases: locationAliases(l.name) })));
  const arriveWords = /(arriv\w*|land\w*|pick ?up|from|start\w*|reach\w*|coming (?:in )?(?:to|at))\W*(?:at|in|to)?\W*$/i;
  const departWords = /(depart\w*|leav\w*|drop\w*|fly(?:ing)? out|back to|end\w*|exit\w*|return\w*|onward)\W*(?:at|in|to|from|via)?\W*$/i;
  const bothWords = /^\W*(in\s*(?:\/|&|and)\s*out|in-out|round ?trip|both ways)/i;
  const unclassified: string[] = [];
  for (const h of placeHits) {
    const before = text.slice(Math.max(0, h.index - 25), h.index);
    const after = text.slice(h.end, h.end + 15);
    if (bothWords.test(after) || /\bin and out of\W*$/i.test(before)) {
      out.arrival_place ??= h.name;
      out.departure_place ??= h.name;
    } else if (/^\W*(out|exit|departure)\b/i.test(after) || departWords.test(before)) out.departure_place ??= h.name;
    else if (/^\W*(in|arrival)\b/i.test(after) || arriveWords.test(before)) out.arrival_place ??= h.name;
    else unclassified.push(h.name);
  }
  for (const name of unclassified) {
    if (!out.arrival_place) out.arrival_place = name;
    else if (!out.departure_place) out.departure_place = name;
  }
  if (out.arrival_place && !out.departure_place && placeHits.length === 1) {
    out.departure_place = out.arrival_place;
    out.notes.push(`Assumed the guest also leaves from ${out.arrival_place}.`);
  }

  return out;
}

// ---------------------------------------------------------------- apply

export interface ApplyResult {
  plan: Plan;
  understood: string[];
  missing: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Match a free-text name (from the rules or from Gemini) to master data.
function matchByName<T extends { name: string }>(items: T[], name: string | undefined, aliases: (n: string) => string[]): T | undefined {
  if (!name) return undefined;
  const n = norm(name);
  return (
    items.find((i) => norm(i.name) === n) ??
    items.find((i) => aliases(i.name).some((a) => norm(a) === n || n.includes(norm(a)))) ??
    items.find((i) => norm(i.name).includes(n) && n.length >= 4)
  );
}

export function applyParsed(plan: Plan, parsed: ParsedTrip, ctx: BuilderContext): ApplyResult {
  const understood: string[] = [];
  const missing: string[] = [];
  const next: Plan = { ...plan, guest: { ...plan.guest }, days: [] };

  if (parsed.adults && parsed.adults > 0) {
    next.guest.adults = Math.min(50, parsed.adults);
    understood.push(`${next.guest.adults} adult${next.guest.adults === 1 ? "" : "s"}`);
  } else missing.push("number of adults");
  if (parsed.children?.length) {
    next.guest.children = parsed.children.slice(0, 20);
    understood.push(`${parsed.children.length} child${parsed.children.length === 1 ? "" : "ren"} (${parsed.children.join(", ")})`);
  }
  if (parsed.rooms && parsed.rooms > 0) {
    next.guest.rooms = Math.min(30, parsed.rooms);
    understood.push(`${next.guest.rooms} room${next.guest.rooms === 1 ? "" : "s"}`);
  } else if (parsed.adults) {
    next.guest.rooms = Math.max(1, Math.ceil(parsed.adults / 2));
    understood.push(`${next.guest.rooms} room${next.guest.rooms === 1 ? "" : "s"} (assumed, 2 per room)`);
  }
  if (parsed.nationality) {
    next.guest.nationality = parsed.nationality;
    understood.push(parsed.nationality === "indian" ? "Indian guests" : "foreign guests");
  }

  if (parsed.arrival_date) {
    next.arrival_date = parsed.arrival_date;
    understood.push(`arriving ${parsed.arrival_date}`);
  } else missing.push("arrival date");

  const rank: Record<string, number> = { airport: 0, railway: 1, city: 2, other: 3 };
  const places = ctx.locations.filter((l) => l.type !== "property").sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  const placeAliases = (n: string) => locationAliases(n);
  const arr = matchByName(places, parsed.arrival_place, placeAliases);
  const dep = matchByName(places, parsed.departure_place, placeAliases);
  if (arr) {
    next.arrival_location_id = arr.id;
    understood.push(`in via ${arr.name}`);
  } else if (parsed.arrival_place) missing.push(`"${parsed.arrival_place}" is not in your airports/stations list`);
  if (dep) {
    next.departure_location_id = dep.id;
    understood.push(`out via ${dep.name}`);
  } else if (parsed.departure_place) missing.push(`"${parsed.departure_place}" is not in your airports/stations list`);

  const stops = [];
  for (const p of parsed.parks) {
    const park = matchByName(ctx.pricing.parks, p.name, aliasesOf);
    if (!park) {
      missing.push(`park "${p.name}"`);
      continue;
    }
    const nights = p.nights && p.nights > 0 ? Math.min(60, p.nights) : 2;
    if (!p.nights) parsed.notes.push(`Nights in ${park.name} not given; set to 2.`);
    const stop = defaultStop(ctx, park.id, nights);
    if (p.lodge) {
      const lodge = matchByName(ctx.properties.filter((x) => x.park_id === park.id), p.lodge, (n) => [n.toLowerCase()]);
      if (lodge) {
        const room = roomsOf(ctx, lodge.id)[0];
        stop.property_id = lodge.id;
        stop.room_category_id = room?.id ?? "";
        stop.meal_plan = room ? mealPlansOf(ctx, room.id)[0] ?? "AP" : "AP";
      }
    }
    if (parsed.meal_plan && stop.room_category_id && mealPlansOf(ctx, stop.room_category_id).includes(parsed.meal_plan)) {
      stop.meal_plan = parsed.meal_plan;
    }
    stops.push(stop);
    const lodgeName = ctx.properties.find((x) => x.id === stop.property_id)?.name;
    understood.push(`${park.name} ${nights} night${nights === 1 ? "" : "s"}${lodgeName ? ` at ${lodgeName}` : ""}`);
  }
  if (stops.length) next.stops = stops;
  else missing.push("parks");

  if (parsed.departure_date && next.arrival_date && stops.length) {
    const planned = stops.reduce((t, s) => t + s.nights, 0);
    const asked = nightsBetween(next.arrival_date, parsed.departure_date);
    if (asked !== planned) parsed.notes.push(`The dates give ${asked} nights but the parks add up to ${planned}. Check the nights.`);
  }

  return { plan: next, understood, missing: [...missing, ...parsed.notes] };
}

// Text safe to send to an outside AI: no emails, phone numbers or long digit runs.
export function scrubForAI(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[number]")
    .slice(0, 1500);
}

export const needsHelp = (p: ParsedTrip) => p.parks.length === 0 || !p.arrival_date;

export function mergeParsed(rule: ParsedTrip, ai: ParsedTrip): ParsedTrip {
  return {
    adults: rule.adults ?? ai.adults,
    children: rule.children?.length ? rule.children : ai.children,
    rooms: rule.rooms ?? ai.rooms,
    nationality: rule.nationality ?? ai.nationality,
    arrival_date: rule.arrival_date ?? ai.arrival_date,
    departure_date: rule.departure_date ?? ai.departure_date,
    arrival_place: rule.arrival_place ?? ai.arrival_place,
    departure_place: rule.departure_place ?? ai.departure_place,
    parks: rule.parks.length ? rule.parks : ai.parks,
    meal_plan: rule.meal_plan ?? ai.meal_plan,
    notes: [...rule.notes, ...ai.notes],
  };
}

