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
import { findCountry, countryName } from "@/lib/sales/countries";

export interface ParsedTrip {
  adults?: number;
  children?: number[]; // ages
  rooms?: number;
  nationality?: "indian" | "foreign";
  country?: string; // ISO code when a nationality or country is named
  arrival_date?: ISODate;
  departure_date?: ISODate;
  arrival_place?: string;
  departure_place?: string;
  parks: ParsedPark[];
  meal_plan?: "AP" | "MAP" | "CP" | "EP";
  notes: string[]; // assumptions made while reading
  flights?: { from: string; to: string; time?: string }[];
  cityStays?: { when: "before" | "after"; city: string; nights: number }[];
  reverse?: boolean; // "wrong direction", "the other way round"
}

// What was said about one park / lodge, read from its own part of the message:
// "...kings lodge for 3 days and do 4 safaris with naturalist, ..."
export interface ParsedPark {
  name: string;
  nights?: number;
  nightsFromDays?: boolean; // "3 days" read as 3 nights
  lodge?: string;
  safaris?: number; // jeep safaris wanted
  naturalists?: number; // how many of them with a naturalist
  extras?: string[]; // experience keywords: "bush dinner", "boat safari"...
  room?: "tree" | "cottage";
}

// Experiences people mention, and the words that find them among the add-ons.
export const EXTRA_WORDS: [RegExp, string][] = [
  [/\b(bush|farm|jungle|private)\s*din(?:ner|ing)\b|\bbush\s*dining\b/, "bush dinner"],
  [/\bboat\s*(?:safari|ride|cruise)\b/, "boat safari"],
  [/\bcanoe(?:ing)?\b/, "canoe"],
  [/\bwalking\s*safari\b/, "walking safari"],
  [/\b(?:nature|escorted)\s*walk\b|\bcycling\b|\bnight\s*trail\b/, "nature walk"],
  [/\bvillage\s*(?:safari|walk|visit|haat)\b/, "village"],
  [/\bpicnic\b/, "picnic"],
  [/\bfull[- ]?day\s*safari\b/, "full-day safari"],
  [/\bisland\s*dinner\b/, "island dinner"],
  [/\bculinary|cooking\s*(?:class|workshop)\b/, "culinary"],
];

// Cities guests fly in and out of, or stay in, outside our lodges.
const CITIES = ["delhi", "new delhi", "mumbai", "bombay", "bengaluru", "bangalore", "kolkata", "calcutta", "chennai", "hyderabad", "jabalpur", "nagpur", "bhopal", "raipur", "khajuraho", "bagdogra", "varanasi", "agra", "jaipur", "udaipur", "indore", "goa", "kathmandu", "jhansi", "satna", "katni", "umaria", "chandrapur", "lucknow", "ahmedabad", "pune"];
const cityName = (c: string) => (c === "new delhi" ? "Delhi" : c === "bombay" ? "Mumbai" : c === "bangalore" ? "Bengaluru" : c === "calcutta" ? "Kolkata" : c.replace(/\b\w/g, (x) => x.toUpperCase()));

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
export function locationAliases(name: string, code?: string | null): string[] {
  const full = name.toLowerCase().trim();
  const core = full.replace(/\b(international|domestic|airport|railway station|railway|station|junction|jn|city|bus stand)\b/g, " ").replace(/\s+/g, " ").trim();
  return [...new Set([full, core, ...(code ? [code.toLowerCase()] : [])].filter((x) => x.length >= 3))];
}

interface Hit {
  index: number;
  end: number;
  name: string;
  lodge?: string;
}
function findAll(text: string, items: { name: string; aliases: string[]; lodge?: string }[]): Hit[] {
  const hits: Hit[] = [];
  for (const it of items) {
    for (const a of it.aliases.sort((x, y) => y.length - x.length)) {
      const re = new RegExp(`\\b${escapeRe(a)}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!hits.some((h) => m!.index < h.end && m!.index + m![0].length > h.index)) {
          hits.push({ index: m.index, end: m.index + m[0].length, name: it.name, lodge: it.lodge });
        }
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}


// ---------------------------------------------------------------- vocabulary

// Words in lodge names that do not identify a lodge on their own.
const GENERIC = new Set(["lodge", "escape", "hideaway", "house", "tree", "treehouse", "earth", "backwater", "camp", "resort", "jungle", "eco", "the", "safari", "retreat"]);

// What people type for a lodge: "Kings Lodge", "kings", "Waghoba", "Treehouse Hideaway".
export function lodgeAliases(name: string, parkAliases: string[]): string[] {
  const full = name.toLowerCase().trim();
  const words = full.split(/\s+/);
  const out = new Set<string>([full, full.replace(/\s+/g, "")]);
  if (words.length >= 3) out.add(words.join(" ").replace(/^(\w+) (\w+)/, "$1$2")); // "treehouse hideaway"
  const stripped = words.filter((w) => !["lodge", "escape", "camp", "resort", "retreat"].includes(w)).join(" ");
  const distinctive = (a: string) => a.split(" ").some((w) => w.length >= 5 && !GENERIC.has(w));
  if (stripped && stripped !== full && distinctive(stripped)) out.add(stripped); // "kanha earth", "waghoba eco"
  if (words.length >= 2 && distinctive(words.slice(0, 2).join(" "))) out.add(words.slice(0, 2).join(" ")); // "denwa backwater"
  if (words[0].length >= 5 && !GENERIC.has(words[0]) && !parkAliases.includes(words[0])) out.add(words[0]); // "waghoba", "kings", "denwa"
  return [...out].filter((a) => a.length >= 4);
}

// Optimal string alignment distance (a swap of two letters counts as one edit).
function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Short forms the team uses for cities and airports.
const ABBREVIATIONS: Record<string, string> = { jbp: "jabalpur", ngp: "nagpur", bpl: "bhopal", rpr: "raipur", hjr: "khajuraho" };

// Correct misspelt park and lodge words ("bandavgarh" -> "bandhavgarh") and
// expand short forms, before anything else reads the text.
function normaliseText(input: string, vocabulary: string[], notes: string[]) {
  let text = input.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ").trim();
  text = text.replace(/\b[a-z]{3}\b/gi, (w) => ABBREVIATIONS[w.toLowerCase()] ?? w);
  const vocab = [...new Set(vocabulary.filter((v) => /^[a-z]+$/.test(v) && v.length >= 5))];
  text = text.replace(/\b[a-zA-Z]{5,}\b/g, (word) => {
    const w = word.toLowerCase();
    if (vocab.includes(w)) return word;
    let best: string | null = null;
    let bestD = 99;
    for (const v of vocab) {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > 2) continue;
      const d = editDistance(w, v);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    // Long names (8+ letters) allow 2 slips. Short ones allow only swapped letters
    // ("kanah") or one missing/extra letter, never a different letter ("punch" stays "punch").
    const sameLetters = best !== null && best.length === w.length && [...best].sort().join("") === [...w].sort().join("");
    const ok = best !== null && (w.length >= 8 ? bestD <= 2 : bestD === 1 && (best.length !== w.length || sameLetters));
    if (best && ok) {
      notes.push(`Read "${word}" as "${best}".`);
      return best;
    }
    return word;
  });
  return text;
}

// ---------------------------------------------------------------- extract

export function extractTrip(input: string, ctx: BuilderContext, today: ISODate): ParsedTrip {
  const out: ParsedTrip = { parks: [], notes: [] };

  // Everything the text can refer to: parks, and lodges (which imply their park).
  const parkItems = ctx.pricing.parks.map((p) => ({ name: p.name, aliases: aliasesOf(p.name) }));
  const allParkAliases = parkItems.flatMap((p) => p.aliases);
  const lodgeItems = ctx.properties
    .map((l) => {
      const park = ctx.pricing.parks.find((p) => p.id === l.park_id);
      return park ? { name: park.name, lodge: l.name, aliases: lodgeAliases(l.name, allParkAliases) } : null;
    })
    .filter((x): x is { name: string; lodge: string; aliases: string[] } => !!x);
  // Only distinctive words are spelling-corrected towards ("bandhavgarh", "waghoba"), never
  // ordinary words like "lodge", "house" or "tiger".
  const COMMON = new Set([...GENERIC, "national", "park", "tiger", "reserve", "sanctuary", "wildlife", "forest", "hotel"]);
  const vocabulary = [...allParkAliases, ...lodgeItems.flatMap((l) => l.aliases)].flatMap((a) => a.split(/[\s-]+/)).filter((w) => !COMMON.has(w));

  const text = normaliseText(input, vocabulary, out.notes);
  const low = text.toLowerCase();

  // ---- guests
  const adultsM =
    low.match(new RegExp(`\\b${NUM}\\s*(?:adults?|pax|people|persons|guests|travell?ers|ppl)\\b`)) ?? low.match(/\b(\d{1,2})\s*a\b(?![\w'])/);
  const familyM = low.match(new RegExp(`\\bfamily of\\s*${NUM}\\b`));
  const kidsM = low.match(new RegExp(`\\b${NUM}\\s*(?:kids?|children|childs?|child|infants?)\\b`));
  const LIST = "(\\d{1,2}(?:\\s*(?:,|and|&|/)\\s*\\d{1,2})*)";
  const ageSources = [
    low.match(new RegExp(`\\b(?:aged?|ages?)\\s*:?\\s*${LIST}`)),
    low.match(new RegExp(`\\b(?:kids?|children|child)\\s*\\(\\s*(?:aged?\\s*)?${LIST}\\s*(?:y(?:ea)?rs?)?\\s*\\)`)),
    low.match(new RegExp(`\\b(?:kids?|children)\\s+(\\d{1,2}(?:\\s*(?:,|and|&|/)\\s*\\d{1,2})+)\\b`)),
    low.match(/\b(?:child|kid|son|daughter)\s+(?:of\s+)?(\d{1,2})\s*(?:y(?:ea)?rs?|yo)\b/),
  ];
  let ages: number[] = [];
  for (const m of ageSources) {
    if (m) {
      ages = m[1].split(/\s*(?:,|and|&|\/)\s*/).map(Number).filter((n) => n >= 0 && n < 18);
      break;
    }
  }
  if (!ages.length) {
    // "a 6 year old", "6-year-old", "6 yr old"
    const yo = [...low.matchAll(/\b(\d{1,2})\s*-?\s*(?:y(?:ea)?r?s?)\s*-?\s*old\b/g)].map((m) => Number(m[1])).filter((n) => n < 18);
    ages = yo;
  }
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

  const roomsM = low.match(
    new RegExp(`\\b${NUM}\\s*(?:(?:double|twin|single|triple|deluxe|ac|a/c|family|standard|luxury|separate)\\s+)*(?:rooms?|cottages?|tents?|suites?|villas?|tree ?houses?|bungalows?)\\b`)
  );
  if (roomsM) out.rooms = toNum(roomsM[1]);

  const country = findCountry(text);
  if (country) {
    out.country = country;
    out.nationality = country === "IN" ? "indian" : "foreign";
  } else if (/\b(indian|domestic|resident)s?\b/.test(low)) out.nationality = "indian";
  else if (/\b(foreign(?:er|ers)?|international|overseas|nri)\b/.test(low)) out.nationality = "foreign";

  if (/\b(full board|all meals|\bap\b|american plan)/.test(low)) out.meal_plan = "AP";
  else if (/\b(map|half board|breakfast and dinner|modified american)\b/.test(low)) out.meal_plan = "MAP";
  else if (/\b(cp|bed and breakfast|b&b|breakfast only|continental plan)\b/.test(low)) out.meal_plan = "CP";
  else if (/\b(ep|room only|european plan)\b/.test(low)) out.meal_plan = "EP";

  // ---- dates (first date found = arrival; a range also gives departure)
  // Years: 4 digits ("2027"), or 2 digits after an apostrophe ("'27").
  const YEAR = `(?:\\s*'\\s*(\\d{2})(?!\\d)|,?\\s*(\\d{4}))?`;
  const yearOf = (two?: string, four?: string) => (four ? Number(four) : two ? 2000 + Number(two) : null);
  const monthOf = (m: string) => MONTHS[m] ?? MONTHS[m.slice(0, 3)];
  const range = low.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|till|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?${YEAR}`));
  const candidates: { at: number; date: ISODate }[] = [];
  const push = (at: number, d: ISODate | null) => d && candidates.push({ at, date: d });
  if (range) {
    const m = monthOf(range[3]);
    const a = makeDate(yearOf(range[4], range[5]), m, Number(range[1]), today);
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
    const dMon = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}\\.?${YEAR}`, "g");
    while ((m = dMon.exec(low))) push(m.index, makeDate(yearOf(m[3], m[4]), monthOf(m[2]), Number(m[1]), today));
    const monD = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b${YEAR}`, "g");
    while ((m = monD.exec(low))) push(m.index, makeDate(yearOf(m[3], m[4]), monthOf(m[1]), Number(m[2]), today));
    candidates.sort((a, b) => a.at - b.at);
    if (candidates[0]) out.arrival_date = candidates[0].date;
    if (candidates[1] && candidates[1].date > candidates[0].date) out.departure_date = candidates[1].date;
  }

  // ---- parks and lodges with nights, in the order written.
  // Lodges are matched first so "Pench Tree Lodge" is one mention, not "Pench" + noise.
  const parkHits = findAll(text, [...lodgeItems, ...parkItems]).reduce<Hit[]>((acc, h) => {
    const last = acc[acc.length - 1];
    // Adjacent mentions of the same park ("tadoba andhari", "Kings Lodge, Bandhavgarh") count as one.
    if (last && last.name === h.name && /^[\s\-/,]*(?:in|at)?[\s\-/,]*$/i.test(text.slice(last.end, h.index)) && (!last.lodge || !h.lodge || last.lodge === h.lodge)) {
      last.end = h.end;
      last.lodge ??= h.lodge;
    } else acc.push({ ...h });
    return acc;
  }, []);

  // Each night count ("4 nights", "4N", "x4") belongs to the place right after
  // it ("4N Kanha") or right before it ("Kanha 4 nights"). When a count could
  // go either way, the writer's usual style decides.
  const gapIsGlue = (gap: string) => /^[\s\W]*(?:(?:in|at|@|of|for|stay(?:ing)?)[\s\W]+)*$/.test(gap.toLowerCase() + " ");
  const tokens: { start: number; end: number; value: number; before?: number; after?: number }[] = [];
  const tokRe = new RegExp(`(?:\\bx\\s*${NUM}\\b|\\b${NUM}\\s*(?:n|nts?|nights?)\\b)`, "gi");
  let tm: RegExpExecArray | null;
  while ((tm = tokRe.exec(text))) {
    const value = toNum((tm[1] ?? tm[2]).toLowerCase());
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
    const existing = out.parks.find((p) => p.name === h.name);
    if (existing) {
      existing.lodge ??= h.lodge; // mentioned twice: keep the first position
      return;
    }
    const nights = parkHits.map((x, i) => (x.name === h.name ? nightsFor.get(i) : undefined)).find((n) => n !== undefined);
    out.parks.push({ name: h.name, nights, lodge: h.lodge });
  });

  // ---- each park's own part of the message: from its first mention up to the
  // next park. Nights ("for 3 days" too), safaris, naturalists, experiences, room.
  const firstAt = out.parks.map((p) => parkHits.find((h) => h.name === p.name)!.index);
  const order = out.parks.map((p, i) => ({ p, at: firstAt[i] })).sort((a, b) => a.at - b.at);
  order.forEach(({ p, at }, k) => {
    const end = k + 1 < order.length ? order[k + 1].at : text.length;
    const seg = ` ${low.slice(at, end)} `;
    if (!p.nights) {
      const m = seg.match(new RegExp(`\\b${NUM}\\s*(nights?|n\\b|nts?|days?)`));
      if (m && toNum(m[1]) > 0 && toNum(m[1]) <= 30) {
        p.nights = toNum(m[1]);
        if (/^d/.test(m[2])) p.nightsFromDays = true;
      }
    }
    const saf = seg.match(new RegExp(`\\b${NUM}\\s*(?:(?:jeep|tiger|core|buffer|game|wildlife)\\s+)?safaris?\\b`));
    if (saf) p.safaris = toNum(saf[1]);
    if (/naturalist/.test(seg)) {
      const some = seg.match(new RegExp(`\\b${NUM}\\s+(?:of them\\s+)?with\\s+(?:an?\\s+|the\\s+)?naturalists?`));
      if (/\bwithout\s+(?:an?\s+|the\s+)?naturalists?\b|\bno\s+naturalists?\b/.test(seg) && !some && !/\bwith\s+(?:an?\s+|the\s+)?naturalist/.test(seg.replace(/without/g, ""))) p.naturalists = 0;
      else p.naturalists = some ? toNum(some[1]) : p.safaris ?? -1; // -1 = every safari
    }
    const extras = EXTRA_WORDS.filter(([re]) => re.test(seg)).map(([, k]) => k);
    if (extras.length) p.extras = extras;
    if (/\btree\s?houses?\b/.test(seg.replace(/tree house hideaway|treehouse hideaway/g, ""))) p.room = "tree";
    else if (/\b(cottages?|bungalows?)\b/.test(seg)) p.room = "cottage";
  });

  // ---- flights and city stays (Delhi nights before or after the safari)
  const cityHits: { at: number; city: string }[] = [];
  for (const c of CITIES) for (const m of low.matchAll(new RegExp(`\\b${c}\\b`, "g"))) cityHits.push({ at: m.index!, city: cityName(c) });
  cityHits.sort((a, b) => a.at - b.at);
  const firstPark = order.length ? order[0].at : Infinity;
  const lastPark = order.length ? order[order.length - 1].at : -Infinity;
  const flights: NonNullable<ParsedTrip["flights"]> = [];
  for (const m of low.matchAll(/\b(?:flight|flights|fly|flying|flies|flew)\b/g)) {
    const after = low.slice(m.index!, m.index! + 70);
    const to = after.match(new RegExp(`\\bto\\s+(${CITIES.join("|")})\\b`));
    if (!to) continue;
    const fromM = after.slice(0, to.index).match(new RegExp(`\\bfrom\\s+(${CITIES.join("|")})\\b`));
    const before = cityHits.filter((h) => h.at < m.index! && h.city !== cityName(to[1])).pop();
    const from = fromM ? cityName(fromM[1]) : before?.city;
    if (!from) continue;
    const time = low.slice(m.index!, m.index! + 90).match(/\b(?:at|@)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|hrs)?)\b/);
    const f = { from, to: cityName(to[1]), ...(time ? { time: time[1].replace(".", ":").replace(/\s*hrs$/, "").trim() } : {}) };
    if (!flights.some((x) => x.from === f.from && x.to === f.to)) flights.push(f);
  }
  if (flights.length) out.flights = flights;
  const stays: NonNullable<ParsedTrip["cityStays"]> = [];
  for (const m of low.matchAll(new RegExp(`\\b(?:stay(?:ing)?|overnight|spend)\\s+(?:in\\s+|at\\s+)?(${CITIES.join("|")}|there)\\s+(?:for\\s+)?${NUM}\\s*nights?\\b`, "g"))) {
    const city = m[1] === "there" ? cityHits.filter((h) => h.at < m.index!).pop()?.city : cityName(m[1]);
    if (!city) continue;
    const when = m.index! < firstPark ? "before" : m.index! > lastPark ? "after" : null;
    if (!when) continue;
    stays.push({ when, city, nights: toNum(m[2]) });
  }
  if (stays.length) out.cityStays = stays;
  if (/\b(reverse|opposite\s+(?:order|direction|way)|other\s+way\s+round|wrong\s+(?:direction|order)|the other way)\b/.test(low)) out.reverse = true;

  if (out.parks.length === 1 && !out.parks[0].nights && out.arrival_date && out.departure_date) {
    out.parks[0].nights = nightsBetween(out.arrival_date, out.departure_date);
  }

  // ---- arrival / departure places (codes like NAG and JLR count too)
  const rank: Record<string, number> = { airport: 0, railway: 1, city: 2, other: 3 };
  const places = ctx.locations.filter((l) => l.type !== "property").sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  const placeHits = findAll(text, places.map((l) => ({ name: l.name, aliases: locationAliases(l.name, l.code) })));
  const arriveWords = /(arriv\w*|arr\.?|land\w*|pick(?:ing)?[\s-]?up(?:\s+(?:from|at))?|from|ex|start\w*|reach\w*|coming (?:in )?(?:to|at))\W*(?:at|in|to)?\W*$/i;
  const departWords = /(depart\w*|dep\.?|leav\w*|drop(?:ping)?(?:\s+off)?|fly(?:ing)?\s+(?:out|back)|back to|end\w*|exit\w*|return\w*|onward)\W*(?:at|in|to|from|via|of)?\W*$/i;
  const bothWords = /^\W*(in\s*(?:\/|&|and)?\s*out|in-out|round ?trip|both ways)\b/i;
  const unclassified: string[] = [];
  for (const h of placeHits) {
    const before = text.slice(Math.max(0, h.index - 25), h.index);
    const after = text.slice(h.end, h.end + 15);
    // Words before the place win; a word after only counts if it follows
    // directly ("Nagpur out"), not when it starts the next phrase (", drop at Raipur").
    if (bothWords.test(after) || /\bin and out of\W*$/i.test(before)) {
      out.arrival_place ??= h.name;
      out.departure_place ??= h.name;
    } else if (departWords.test(before)) out.departure_place ??= h.name;
    else if (arriveWords.test(before)) out.arrival_place ??= h.name;
    else if (/^\s*(out|exit|departure|drop)\b/i.test(after)) out.departure_place ??= h.name;
    else if (/^\s*(in|arrival|pick ?up)\b/i.test(after)) out.arrival_place ??= h.name;
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
export function matchByName<T extends { name: string }>(items: T[], name: string | undefined, aliases: (n: string) => string[]): T | undefined {
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
  if (parsed.country) {
    next.guest.country = parsed.country;
    next.guest.nationality = parsed.country === "IN" ? "indian" : "foreign";
    understood.push(`guests from ${countryName(parsed.country)}`);
  } else if (parsed.nationality) {
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
    country: rule.country ?? ai.country,
    arrival_date: rule.arrival_date ?? ai.arrival_date,
    departure_date: rule.departure_date ?? ai.departure_date,
    arrival_place: rule.arrival_place ?? ai.arrival_place,
    departure_place: rule.departure_place ?? ai.departure_place,
    parks: rule.parks.length ? rule.parks : ai.parks,
    meal_plan: rule.meal_plan ?? ai.meal_plan,
    notes: [...rule.notes, ...ai.notes],
  };
}

