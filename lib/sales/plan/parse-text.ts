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
import { addDays } from "@/lib/sales/pricing/dates";
import { defaultStop, mealPlansOf, roomsOf } from "./planner";
import type { BuilderContext, Plan, TravelMode } from "./types";
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
  cityStays?: { when: "before" | "after"; city: string; nights: number; hotel?: string; price?: number; want_extras?: string[] }[];
  reverse?: boolean; // "wrong direction", "the other way round"
  removeParks?: string[]; // parks to take out (from the AI)
  order?: string[]; // parks in a new order (from the AI)
  replaceRoute?: boolean; // the message describes a whole new route (from the AI)
  // how they travel: to the first lodge, at the end, and between the lodges
  arrival_mode?: TravelMode;
  departure_mode?: TravelMode;
  between?: "ours" | "own";
  own_all?: boolean; // their own vehicle for the whole trip ("bus own", "self drive")
  same_out?: boolean; // "same airport": they leave from where they arrive
  requests?: string[]; // "honeymoon", "vegetarian", "photographers"...
  asks?: Ask[]; // what is unclear: asked, never guessed
  notOurs?: string[]; // parks named that are not ours ("Ranthambore")
  month?: number; // a month without a day ("in July", "1st week of Feb")
  unknown?: string[]; // words the reader could not place
}

// A question the reader needs answered. "until" closes it on its own once the plan has
// that detail (a date, the nights, the adults); otherwise the next reply answers it.
export interface Ask {
  key: string;
  text: string;
  quick?: string[];
  until?: "date" | "nights" | "adults";
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
  room?: RoomWish;
  roomName?: string; // a room named by its own word ("stilted" = Stilted River Facing Cottage)
  sessions?: "morning" | "afternoon"; // "morning safaris only"
  jeeps?: number; // "2 jeeps per safari"
  qty?: Record<string, number>; // "camera 1"
}

// Room wishes people write: "tree house", "cottage", "forest suite", "deluxe room".
export type RoomWish = "tree" | "cottage" | "suite" | "deluxe";
export const ROOM_MATCH: Record<RoomWish, RegExp> = {
  suite: /suite/i,
  deluxe: /deluxe room/i,
  tree: /tree ?house/i,
  cottage: /cottage|bungalow/i,
};
// Words in room names that do not pick one room on their own.
const ROOM_GENERIC = new Set(["room", "rooms", "cottage", "cottages", "deluxe", "suite", "suites", "house", "houses", "facing", "luxury", "super", "premium", "standard", "family", "double", "twin", "jungle", "forest", "river", "garden", "valley"]);

export function roomWishIn(text: string): RoomWish | null {
  const t = text.toLowerCase().replace(/tree ?house hideaway/g, "");
  if (/\bforest\s*suites?\b|\bsuites?\b/.test(t)) return "suite";
  if (/\bdeluxe\s*rooms?\b/.test(t)) return "deluxe";
  if (/\btree\s?houses?\b/.test(t)) return "tree";
  if (/\b(cottages?|bungalows?)\b/.test(t)) return "cottage";
  return null;
}

// Experiences people mention, and the words that find them among the add-ons.
export const EXTRA_WORDS: [RegExp, string][] = [
  [/\b(bush|farm|jungle|private)\s*din(?:ner|ing)\b|\bbush\s*dining\b/, "bush dinner"],
  [/\bnight\s*boat\s*(?:safari|ride|cruise)\b/, "night boat safari"],
  [/(?<!night\s?)\bboat\s*(?:safari|ride|cruise)\b/, "boat safari"],
  [/\b(?:fishing|angling)\b/, "fishing"],
  [/\bcameras?\b/, "camera"],
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
const CITIES = ["delhi", "new delhi", "mumbai", "bombay", "bengaluru", "bangalore", "kolkata", "calcutta", "chennai", "hyderabad", "jabalpur", "nagpur", "bhopal", "raipur", "khajuraho", "bagdogra", "varanasi", "agra", "jaipur", "udaipur", "indore", "goa", "kathmandu", "jhansi", "satna", "katni", "umaria", "chandrapur", "lucknow", "ahmedabad", "pune", "guwahati"];
const INDIAN_CITIES = CITIES.filter((c) => c !== "kathmandu");
const cityName = (c: string) => (c === "new delhi" ? "Delhi" : c === "bombay" ? "Mumbai" : c === "bangalore" ? "Bengaluru" : c === "calcutta" ? "Kolkata" : c.replace(/\b\w/g, (x) => x.toUpperCase()));

// ---------------------------------------------------------------- helpers

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  a: 1, an: 1, single: 1, couple: 2, pair: 2,
  // Hindi, as the team types it
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, chhah: 6, saat: 7,
};
const HINDI_NUM = "ek|do|teen|chaa?r|paa?nch|chhe|chhah|saat";
const NUM = `(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|${HINDI_NUM})`;
// without "do": "to do safaris" is not two safaris
const NUM_NO_DO = NUM.replace("|do|", "|");
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

// Does the text name this lodge ("kings", "Kings Lodge", "treehouse hideaway")?
export function lodgeNamedIn(text: string, lodgeName: string, ctx: BuilderContext): boolean {
  const parkAliases = ctx.pricing.parks.flatMap((p) => aliasesOf(p.name));
  return lodgeAliases(lodgeName, parkAliases).some((a) => new RegExp(`\\b${escapeRe(a)}\\b`, "i").test(text));
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

// Short forms the team uses for cities, airports, parks and lodges (as in the AI glossary).
const ABBREVIATIONS: Record<string, string> = {
  jbp: "jabalpur", ngp: "nagpur", bpl: "bhopal", rpr: "raipur", hjr: "khajuraho",
  thh: "tree house hideaway", kl: "kings lodge", kel: "kanha earth lodge", ptl: "pench tree lodge", wel: "waghoba eco lodge",
  dbe: "denwa backwater escape", krl: "ken river lodge", bag: "bandhavgarh", bdg: "bandhavgarh",
};

// Phrases taught to the reader (approved rules, the glossary): each is read as its
// meaning, whole words only, longest phrase first.
export function applyRules(text: string, rules: { phrase: string; meaning: string }[] = [], notes: string[] = []) {
  const usable = rules
    .map((r) => ({ phrase: r.phrase.trim().replace(/\s+/g, " "), meaning: r.meaning.trim() }))
    .filter((r) => r.phrase.length >= 2 && r.meaning && r.meaning.length <= 80 && r.phrase.toLowerCase() !== r.meaning.toLowerCase())
    .sort((a, b) => b.phrase.length - a.phrase.length);
  let out = text;
  for (const r of usable) {
    const re = new RegExp(`(?<![\\p{L}\\d])${escapeRe(r.phrase).replace(/ /g, "\\s+")}(?![\\p{L}\\d])`, "giu");
    if (!re.test(out)) continue;
    // "THH" taught as "Tree House Hideaway (Bandhavgarh)": the bracket is a hint for people
    const meaning = r.meaning.replace(/\s*\([^)]*\)\s*$/, "");
    out = out.replace(re, () => meaning);
    notes.push(`Read "${r.phrase}" as "${meaning}" (taught).`);
  }
  return out;
}

// Correct misspelt park and lodge words ("bandavgarh" -> "bandhavgarh") and
// expand short forms, before anything else reads the text.
function normaliseText(input: string, vocabulary: string[], notes: string[], rules: { phrase: string; meaning: string }[] = []) {
  let text = input.replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ").trim();
  text = applyRules(text, rules, notes);
  text = text.replace(/\b[a-z]{2,3}\b/gi, (w) => ABBREVIATIONS[w.toLowerCase()] ?? w);
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

// hotels: the city hotels in Master data (Roseate House in Delhi), so "1 night at Roseate House" is a Delhi night
export function extractTrip(input: string, ctx: BuilderContext, today: ISODate, hotels: { name: string; city: string }[] = []): ParsedTrip {
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

  const text = normaliseText(input, vocabulary, out.notes, ctx.readerRules);
  const low = text.toLowerCase();
  const asks: Ask[] = [];
  const ask = (a: Ask) => !asks.some((x) => x.key === a.key) && asks.push(a);

  // ---- guests
  const adultsM =
    low.match(new RegExp(`\\b${NUM}\\s*(?:adults?|pax|people|persons|guests?|travell?ers|ppl|log|logon?|bande|aadmi)\\b`)) ??
    low.match(/\b(\d{1,2})\s*a\b(?![\w'])/) ??
    // "2 indian", "3 foreigners"
    low.match(new RegExp(`\\b${NUM}\\s+(?:indians?|foreigners?|foreign nationals?|nris?)\\b`));
  const familyM = low.match(new RegExp(`\\bfamily of\\s*${NUM}\\b`));
  const kidsM = low.match(new RegExp(`\\b${NUM}\\s*(?:kids?|children|childs?|child|infants?|bacche|bachche|bachhe|bachon|bacchon)\\b`));
  const LIST = "(\\d{1,2}(?:\\s*(?:,|and|&|/)\\s*\\d{1,2})*)";
  const ageSources = [
    low.match(new RegExp(`\\b(?:aged?|ages?)\\s*:?\\s*${LIST}`)),
    low.match(new RegExp(`\\b(?:kids?|children|child|infants?|bab(?:y|ies))\\s*\\(\\s*(?:aged?\\s*)?${LIST}\\s*(?:y(?:ea)?rs?|yo)?\\s*(?:old\\s*)?\\)`)),
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
        ask({ key: "ages", text: `How old ${kidCount === 1 ? "is the child" : `are the ${kidCount} children`}? (10 is used until then.)` });
        ages = [...ages, ...Array(kidCount - ages.length).fill(10)];
      }
    }
    out.children = ages;
  }

  if (adultsM) out.adults = toNum(adultsM[1]);
  else if (familyM) out.adults = Math.max(1, toNum(familyM[1]) - (out.children?.length ?? 0));
  else if (/\bcouple\b/.test(low)) out.adults = 2;
  else if (/\b(solo|single traveller|single traveler)\b/.test(low)) out.adults = 1;

  // "elderly mother (72)": an older adult named apart from the count. Travelling too? Asked.
  const elder = low.match(/\b(?:elderly\s+|old\s+|aged\s+)?(mother|father|mom|dad|parents?|grand(?:mother|father|parents?)|mother-in-law|father-in-law|in-laws?)\s*\(?\s*(?:aged?\s*)?(\d{2})\s*(?:y(?:ea)?rs?|yo)?\s*\)?/);
  if (elder && Number(elder[2]) >= 18) {
    const n = out.adults ?? 0;
    const who = `${elder[1]} (${elder[2]})`;
    ask({
      key: "adult-extra",
      text: n ? `Is the ${who} travelling too, making ${n + 1} adults? Or is the ${who} one of the ${n}?` : `How many adults in all, with the ${who}?`,
      quick: n ? [`${n + 1} adults`, `${n} adults`] : undefined,
      until: n ? undefined : "adults",
    });
  }

  const roomsM = low.match(
    new RegExp(`\\b${NUM}\\s*(?:(?:double|twin|single|triple|deluxe|ac|a/c|family|standard|luxury|separate)\\s+)*(?:rooms?|cottages?|tents?|suites?|villas?|tree ?houses?|bungalows?)\\b`)
  );
  if (roomsM) out.rooms = toNum(roomsM[1]);

  // the country straight after the guests: "3 adults US", "2 adults france"
  const afterGuests = low.match(/\b(?:adults?|pax|people|persons|guests?|couple|travell?ers?)\s*,?\s+([a-z]+(?:\s+[a-z]+)?)/);
  const country = findCountry(text) ?? (afterGuests ? findCountry(`from ${afterGuests[1]}`) ?? findCountry(`from ${afterGuests[1].split(" ")[0]}`) : null);
  if (country) {
    out.country = country;
    out.nationality = country === "IN" ? "indian" : "foreign";
  } else if (/\b(indian|domestic|resident)s?\b/.test(low)) out.nationality = "indian";
  else if (/\b(foreign(?:er|ers)?|international|overseas|nri)\b/.test(low)) out.nationality = "foreign";
  else {
    // "a family from Mumbai": guests coming from an Indian city are Indian (not "flying from Mumbai")
    const home = low.match(new RegExp(`(?<!(?:fly\\w*|flight\\w*|depart\\w*)\\s+)\\bfrom\\s+(${INDIAN_CITIES.join("|")})\\b`));
    if (home) {
      out.nationality = "indian";
      out.country = "IN";
      out.notes.push(`Guests from ${cityName(home[1])}: read as Indian.`);
    }
  }

  if (/\b(full board|all meals|\bap\b|american plan)/.test(low)) out.meal_plan = "AP";
  else if (/\b(map|half board|breakfast and dinner|modified american)\b/.test(low)) out.meal_plan = "MAP";
  else if (/\b(cp|bed and breakfast|b&b|breakfast only|continental plan)\b/.test(low)) out.meal_plan = "CP";
  else if (/\b(ep|room only|european plan)\b/.test(low)) out.meal_plan = "EP";

  // ---- dates (first date found = arrival; a range also gives departure)
  // Years: 4 digits ("2027"), 2 digits after an apostrophe ("'27"), or 2 digits on their own
  // ("16 jan 27") when no count follows them ("16 jan 27 nagpur", not "16 jan 2 adults").
  const UNIT_AFTER = "n|nts?|nights?|raat\\w*|din|days?|d|pax|adults?|people|persons|log|kids?|children|rooms?|safaris?|jeeps?|am|pm|hrs?|yrs?|years?|x";
  const YEAR = `(?:\\s*'\\s*(\\d{2})(?!\\d)|,?\\s*(\\d{4})|\\s+(\\d{2})(?![\\d:./-])(?!\\s*(?:${UNIT_AFTER})\\b))?`;
  const yearOf = (two?: string, four?: string, bare?: string) => {
    if (four) return Number(four);
    if (two) return 2000 + Number(two);
    const y = bare ? Number(bare) : NaN;
    const now = Number(today.slice(2, 4));
    return y >= now && y <= now + 3 ? 2000 + y : null; // "27" next year, never a day count
  };
  const monthOf = (m: string) => MONTHS[m] ?? MONTHS[m.slice(0, 3)];
  const range = low.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|till|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?${YEAR}`));
  const candidates: { at: number; date: ISODate }[] = [];
  let firstDateAt: number | null = null; // where the arrival date is written
  // one date per piece of text: "16 jan 27" is 16 Jan 2027, not also "jan 27"
  const spans: [number, number][] = [];
  const push = (at: number, d: ISODate | null, len = 1) => {
    if (!d || spans.some(([a, b]) => at < b && at + len > a)) return;
    spans.push([at, at + len]);
    candidates.push({ at, date: d });
  };
  if (range) {
    const m = monthOf(range[3]);
    const a = makeDate(yearOf(range[4], range[5], range[6]), m, Number(range[1]), today);
    const b = a ? makeDate(Number(a.slice(0, 4)), m, Number(range[2]), a) : null;
    if (a && b && b > a) {
      firstDateAt = range.index!;
      out.arrival_date = a;
      out.departure_date = b;
    }
  }
  if (!out.arrival_date) {
    let m: RegExpExecArray | null;
    const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = iso.exec(low))) push(m.index, makeDate(Number(m[1]), Number(m[2]), Number(m[3]), today), m[0].length);
    const dmy = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g; // Indian order: day first
    while ((m = dmy.exec(low))) push(m.index, makeDate(Number(m[3]), Number(m[2]), Number(m[1]), today), m[0].length);
    const dMon = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH}\\.?${YEAR}`, "g");
    while ((m = dMon.exec(low))) push(m.index, makeDate(yearOf(m[3], m[4], m[5]), monthOf(m[2]), Number(m[1]), today), m[0].length);
    // "Jan 16", never "july 2 nights"
    const monD = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:${UNIT_AFTER})\\b)${YEAR}`, "g");
    while ((m = monD.exec(low))) push(m.index, makeDate(yearOf(m[3], m[4], m[5]), monthOf(m[1]), Number(m[2]), today), m[0].length);
    // "16/1" (day first, no year), never a list of ages ("kids 6/9")
    const dm = /(?<![\d/.-])\b(\d{1,2})\/(\d{1,2})\b(?![\d/])/g;
    while ((m = dm.exec(low))) {
      if (/\b(?:kids?|children|child|ages?|aged)\b[^.]{0,12}$/.test(low.slice(Math.max(0, m.index - 20), m.index))) continue;
      push(m.index, makeDate(null, Number(m[2]), Number(m[1]), today), m[0].length);
    }
    // "next month 5th", "5th of next month"
    const nextMonth = /\bnext\s+month(?:'s)?\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?next\s+month\b/g;
    while ((m = nextMonth.exec(low))) {
      const y = Number(today.slice(0, 4));
      const mo = Number(today.slice(5, 7));
      push(m.index, makeDate(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, Number(m[1] ?? m[2]), today), m[0].length);
    }
    candidates.sort((a, b) => a.at - b.at);
    if (candidates[0]) {
      out.arrival_date = candidates[0].date;
      firstDateAt = candidates[0].at;
    }
    if (candidates[1] && candidates[1].date > candidates[0].date) out.departure_date = candidates[1].date;
  }
  // A month without a day: "1st week of Feb", "mid March", "in July". Asked, never guessed.
  if (!out.arrival_date) {
    const vague = low.match(new RegExp(`\\b((?:1st|first|2nd|second|3rd|third|4th|fourth|last)\\s+week|early|mid|middle|end|beginning|start)\\s+(?:of\\s+)?${MONTH}\\b`));
    // "in july 2 nights" is a month; "in july 2nd" would have been a date
    const inMonth = low.match(new RegExp(`\\b(?:in|during|for|month of|around)\\s+${MONTH}\\b(?!\\s*\\d{1,2}(?:st|nd|rd|th)?\\b(?!\\s*(?:${UNIT_AFTER})\\b))`));
    const mo = vague ? monthOf(vague[2]) : inMonth ? monthOf(inMonth[1]) : undefined;
    if (mo) {
      out.month = mo;
      const what = vague ? `"${vague[0]}"` : "January February March April May June July August September October November December".split(" ")[mo - 1];
      ask({ key: "date", text: `${what}: what is the exact arrival date? Or say "dates not fixed" to quote by season.`, until: "date" });
    }
  }
  const month = out.arrival_date ? Number(out.arrival_date.slice(5, 7)) : out.month;
  if (month && month >= 7 && month <= 9) out.notes.push("July to September is the monsoon: core zones are closed, so only buffer safaris can be planned.");
  // "25 dec - new year": over 31 Dec a minimum stay and the New Year supplement apply
  if (/\bnew\s*year|\bnye\b|\b31(?:st)?\s*dec/.test(low)) {
    ask({ key: "newyear", text: "Over New Year (31 Dec) the minimum stay is 3 nights and the New Year supplement applies. Do the dates cover 31 Dec? Please confirm the arrival date and the nights." });
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
  // "...kings for 1 night, then 1 night in tree house" inside the Bandhavgarh part:
  // "tree house" there is the park's other lodge (Tree House Hideaway), not a room.
  // ("bandhavgarh kings 1n, tree house 1n" too)
  for (const m of low.matchAll(/(?:\b(?:in|at)\s+(?:the\s+)?|[,+&]\s*|\b(?:and|then|phir)\s+)tree\s?house\b(?!\s*hideaway)/g)) {
    const at = m.index! + m[0].search(/tree/);
    const prev = parkHits.filter((h) => h.end <= at).pop();
    if (!prev) continue;
    const park = ctx.pricing.parks.find((p) => p.name === prev.name);
    const other = ctx.properties.find((l) => l.park_id === park?.id && /tree ?house/i.test(l.name) && l.name !== prev.lodge);
    if (!other || parkHits.some((h) => h.lodge === other.name)) continue;
    parkHits.push({ index: at, end: at + 10, name: prev.name, lodge: other.name });
  }
  parkHits.sort((a, b) => a.index - b.index);

  // Each night count ("4 nights", "4N", "x4") belongs to the place right after
  // it ("4N Kanha") or right before it ("Kanha 4 nights"). When a count could
  // go either way, the writer's usual style decides.
  const gapIsGlue = (gap: string) => /^[\s\W]*(?:(?:in|at|@|of|for|stay(?:ing)?)[\s\W]+)*$/.test(gap.toLowerCase() + " ");
  const tokens: { start: number; end: number; value: number; before?: number; after?: number }[] = [];
  const tokRe = new RegExp(`(?:\\bx\\s*${NUM}\\b|\\b${NUM}\\s*(?:n|nts?|nights?|raat(?:ein|en|e)?)\\b)`, "gi");
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
  parkHits.forEach((h, hi) => {
    // a second, different lodge in the same park is its own stop (Kings, then Tree House Hideaway)
    const existing = out.parks.find((p) => p.name === h.name && (!p.lodge || !h.lodge || p.lodge === h.lodge));
    if (existing) {
      existing.lodge ??= h.lodge; // mentioned twice: keep the first position
      if (existing.nights === undefined && nightsFor.has(hi)) existing.nights = nightsFor.get(hi);
      return;
    }
    out.parks.push({ name: h.name, nights: nightsFor.get(hi), lodge: h.lodge });
  });

  // ---- each park's own part of the message: from its first mention up to the
  // next park. Nights ("for 3 days" too), safaris, naturalists, experiences, room.
  // each stop's part starts at its own mention: a lodge's own name first, else the park's
  const firstAt = out.parks.map((p) => (parkHits.find((h) => h.name === p.name && h.lodge && h.lodge === p.lodge) ?? parkHits.find((h) => h.name === p.name && (!p.lodge || !h.lodge || h.lodge === p.lodge)))!.index);
  // a park mention just before its first lodge ("bandhavgarh, stay in kings") belongs to that lodge's part
  out.parks.forEach((p, i) => {
    const parkFirst = parkHits.find((h) => h.name === p.name)!.index;
    if (parkFirst < firstAt[i] && !out.parks.some((q, j) => j !== i && q.name === p.name && firstAt[j] < firstAt[i])) firstAt[i] = parkFirst;
  });
  const order = out.parks.map((p, i) => ({ p, at: firstAt[i] })).sort((a, b) => a.at - b.at);

  // Wishes for every stop, wherever they are written: "1 safari each", "1 safari with
  // naturalist each place", "morning safari only", "2 jeeps per safari". They are blanked
  // out (same length) before each stop's own part is read, so they count once, for all.
  let lowSeg = low;
  const placeWords = new Set([...ctx.properties, ...ctx.pricing.parks].flatMap((x) => x.name.toLowerCase().split(/[^a-z]+/)));
  const each = "(?:at\\s+|in\\s+)?(?:each|every|per)(?:\\s+(?:place|stop|lodge|park|location))?\\b";
  const global = (re: RegExp, read: (m: RegExpMatchArray) => void) => {
    for (const m of low.matchAll(re)) {
      read(m);
      lowSeg = lowSeg.slice(0, m.index!) + " ".repeat(m[0].length) + lowSeg.slice(m.index! + m[0].length);
    }
  };
  const all: Partial<ParsedPark> = {};
  global(new RegExp(`\\b${NUM}\\s+(?:jeep\\s+)?safaris?\\s+with\\s+(?:an?\\s+|the\\s+)?naturalists?\\s+${each}`, "g"), (m) => (all.naturalists = toNum(m[1])));
  global(new RegExp(`\\b${NUM_NO_DO}\\s+(?:jeep\\s+)?safaris?\\s+${each}`, "g"), (m) => (all.safaris = toNum(m[1])));
  global(/\b(?:(morning|evening|afternoon)\s+safaris?\s+only|only\s+(morning|evening|afternoon)\s+safaris?|(morning|evening|afternoon)s?\s+only)\b/g, (m) => {
    all.sessions = /morning/.test(m[0]) ? "morning" : "afternoon";
  });
  global(new RegExp(`\\b${NUM}\\s+(?:jeeps?|vehicles?|gypsys?|gypsies)\\s+(?:per|each|for each|for every|every|in each)\\s+safari\\b`, "g"), (m) => (all.jeeps = toNum(m[1])));

  order.forEach(({ p, at }, k) => {
    const end = k + 1 < order.length ? order[k + 1].at : text.length;
    const seg = ` ${lowSeg.slice(at, end)} `;
    if (!p.nights) {
      const lead = low.slice(Math.max(0, at - 24), at).match(new RegExp(`\\b${NUM}\\s*nights?\\s+(?:in|at)\\s+(?:the\\s+)?$`));
      if (lead) p.nights = toNum(lead[1]);
    }
    if (!p.nights) {
      const m = seg.match(new RegExp(`\\b${NUM}\\s*(nights?|n\\b|nts?|days?|raat(?:ein|en|e)?\\b|din\\b)`));
      if (m && toNum(m[1]) > 0 && toNum(m[1]) <= 30) {
        p.nights = toNum(m[1]);
        if (/^d/.test(m[2])) p.nightsFromDays = true;
      }
    }
    const saf = seg.match(new RegExp(`\\b${NUM_NO_DO}\\s*(?:(?:jeep|tiger|core|buffer|game|wildlife)\\s+)?safaris?\\b`));
    if (saf) p.safaris = toNum(saf[1]);
    if (/naturalist/.test(seg)) {
      const some = seg.match(new RegExp(`\\b${NUM}\\s+(?:of them\\s+)?(?:(?:jeep\\s+)?safaris?\\s+)?with\\s+(?:an?\\s+|the\\s+)?naturalists?`));
      if (/\bwithout\s+(?:an?\s+|the\s+)?naturalists?\b|\bno\s+naturalists?\b/.test(seg) && !some && !/\bwith\s+(?:an?\s+|the\s+)?naturalist/.test(seg.replace(/without/g, ""))) p.naturalists = 0;
      else p.naturalists = some ? toNum(some[1]) : p.safaris ?? -1; // -1 = every safari
    }
    const extras = EXTRA_WORDS.filter(([re]) => re.test(seg)).map(([, k]) => k);
    // fishing: half day or full day (asked when not said)
    const fi = extras.indexOf("fishing");
    if (fi >= 0) {
      const len = seg.match(/\b(half|full)[- ]?day\s+fishing\b|\bfishing\s*\(?\s*(half|full)[- ]?day\b/);
      if (len) extras[fi] = `${len[1] ?? len[2]} day fishing`;
      else ask({ key: `fishing:${p.name}`, text: `Fishing at ${p.lodge ?? p.name}: half day or full day?`, quick: ["Half-day fishing", "Full-day fishing"] });
    }
    if (extras.length) p.extras = extras;
    const cam = seg.match(/\bcameras?(?:\s*fees?)?\s*(?:x\s*)?(\d{1,2})\b|\b(\d{1,2})\s*cameras?\b/);
    if (cam) p.qty = { camera: Number(cam[1] ?? cam[2]) };
    const room = roomWishIn(seg);
    if (room) p.room = room;
    // a room named by a word of its own ("stilted" = Stilted River Facing Cottage)
    const park = ctx.pricing.parks.find((x) => x.name === p.name);
    const lodgeIds = ctx.properties.filter((l) => l.park_id === park?.id && (!p.lodge || l.name === p.lodge)).map((l) => l.id);
    const named = ctx.rooms
      .filter((r) => lodgeIds.includes(r.property_id))
      .find((r) => r.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 5 && !ROOM_GENERIC.has(w) && !placeWords.has(w) && new RegExp(`\\b${w}\\b`).test(seg)));
    if (named) p.roomName = named.name;
    for (const key of Object.keys(all) as (keyof typeof all)[]) if (p[key] === undefined) Object.assign(p, { [key]: all[key] });
  });
  // "4N4D kanha bandhavgarh": the total is given, not the split. Asked.
  const total = low.match(/\b(\d{1,2})\s*n\s*\/?\s*(\d{1,2})\s*d\b/);
  if (total && out.parks.length > 1 && out.parks.some((p) => !p.nights)) {
    const names = out.parks.map((p) => p.name.split(/[ -]/)[0]);
    ask({ key: "split", text: `${total[1]} nights in all: how many in ${names.slice(0, -1).join(", ")} and how many in ${names[names.length - 1]}?`, until: "nights" });
  }

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
    // "from Delhi to Raipur", "flying delhi to raipur"
    const fromM = after.slice(0, to.index).match(new RegExp(`(?:\\bfrom\\s+)?\\b(${CITIES.join("|")})\\b`));
    const before = cityHits.filter((h) => h.at < m.index! && h.city !== cityName(to[1])).pop();
    const from = fromM ? cityName(fromM[1]) : before?.city;
    if (!from) continue;
    const time = low.slice(m.index!, m.index! + 90).match(/\b(?:at|@)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|hrs)?)\b/);
    const f = { from, to: cityName(to[1]), ...(time ? { time: time[1].replace(".", ":").replace(/\s*hrs$/, "").trim() } : {}) };
    if (!flights.some((x) => x.from === f.from && x.to === f.to)) flights.push(f);
  }
  for (const m of low.matchAll(new RegExp(`\\b(?:leave|leaving|leaves|depart(?:ing|s)?|return(?:ing|s)?|fly(?:ing)?\\s+back|head(?:ing)?\\s+back|go(?:ing)?\\s+back)\\s+from\\s+(${CITIES.join("|")})\\s+to\\s+(${CITIES.join("|")})\\b`, "g"))) {
    const f = { from: cityName(m[1]), to: cityName(m[2]) };
    if (f.from !== f.to && !/^\W*(?:by\s+)?(?:road|car|train|drive)/.test(low.slice(m.index! + m[0].length, m.index! + m[0].length + 15)) && !flights.some((x) => x.from === f.from && x.to === f.to)) flights.push(f);
  }
  // the route before the word: "nagpur to delhi flight", "jaipur-nagpur by air"
  for (const m of low.matchAll(new RegExp(`\\b(${CITIES.join("|")})\\s*(?:to|-)\\s*(${CITIES.join("|")})\\s+(?:flights?|by\\s+(?:air|flight))\\b`, "g"))) {
    const f = { from: cityName(m[1]), to: cityName(m[2]) };
    if (f.from !== f.to && !flights.some((x) => x.from === f.from && x.to === f.to)) flights.push(f);
  }
  // "flight 6:40 am" written apart from the route: noted on the one flight, and asked which way it is
  const clock = low.match(/\bflights?\s+(?:time\s+)?(?:is\s+)?(?:at\s+|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|hrs)?\b(?!\s*(?:n|nights?|pax|adults?|days?)\b)/);
  if (clock && flights.length === 1 && !flights[0].time && (clock[2] || clock[3])) {
    let h = Number(clock[1]);
    if (clock[3] === "pm" && h < 12) h += 12;
    if (clock[3] === "am" && h === 12) h = 0;
    if (h <= 23) {
      const time = `${pad(h)}:${clock[2] ?? "00"}`;
      flights[0].time = time;
      ask({ key: "flight-time", text: `The ${time} flight: is it the arrival flight (${flights[0].from} to ${flights[0].to}) or the flight home?`, quick: ["Arrival flight", "Departure flight"] });
    }
  }
  if (flights.length) out.flights = flights;
  const stays: NonNullable<ParsedTrip["cityStays"]> = [];
  const CITY_RE = CITIES.join("|");
  const stayPatterns = [
    // "stay in Delhi for one night", "stay there 2 nights", "spend 2 nights in Delhi"
    new RegExp(`\\b(?:stay(?:ing)?|overnight|spend(?:ing)?)\\s+(?:in\\s+|at\\s+)?(?<city>${CITY_RE}|there)\\s+(?:for\\s+)?(?<n>${NUM.slice(1, -1)})\\s*nights?\\b`, "g"),
    // "stay one night at Delhi", "spend 2 nights in Delhi"
    new RegExp(`\\b(?:stay(?:ing)?|spend(?:ing)?)\\s+(?:for\\s+)?(?<n>${NUM.slice(1, -1)})\\s*nights?\\s+(?:in|at)\\s+(?<city>${CITY_RE}|there)\\b`, "g"),
    // "1 night in Delhi", "1 nights stay at delhi", "1 night khajuraho"
    new RegExp(`\\b(?<n>${NUM.slice(1, -1)})\\s*nights?\\s+(?:stay\\s+|halt\\s+)?(?:(?:in|at)\\s+)?(?<city>${CITY_RE})\\b`, "g"),
    // "Delhi 1 nights stay", "transfer to Khajuraho 2 nights", "Delhi - 1 night"
    new RegExp(`\\b(?<city>${CITY_RE})\\s*(?:[-:(]\\s*|for\\s+)?(?<n>${NUM.slice(1, -1)})\\s*(?:nights?|n|raat(?:ein|en|e)?)\\b`, "g"),
  ];
  // text already read as a city stay (start, end): a second pattern on the same words is skipped
  const seen: [number, number][] = [];
  const taken = (m: RegExpMatchArray) => seen.some(([a, b]) => m.index! < b && m.index! + m[0].length > a);
  for (const re of stayPatterns) {
    for (const m of low.matchAll(re)) {
      if (taken(m)) continue;
      let city: string | undefined;
      if (m.groups!.city === "there") {
        // "there" is the nearest place mentioned before: if that is a park, this is not a city stay
        const c = cityHits.filter((h) => h.at < m.index!).pop();
        const pk = parkHits.filter((h) => h.index < m.index!).pop();
        if (!c || (pk && pk.index > c.at)) continue;
        city = c.city;
      } else city = cityName(m.groups!.city);
      const when = m.index! < firstPark ? "before" : m.index! > lastPark ? "after" : null;
      // several cities are fine (Khajuraho, then Delhi at the end); the same city twice on one side is not
      if (!when || stays.some((x) => x.when === when && x.city === city)) continue;
      seen.push([m.index!, m.index! + m[0].length]);
      stays.push({ when, city, nights: toNum(m.groups!.n), at: m.index! } as (typeof stays)[number] & { at: number });
    }
  }
  // a night at a city hotel from Master data without the city's name: "1 night stay at Roseate House"
  const GENERIC_HOTEL = new Set(["hotel", "the", "house", "resort", "inn", "lodge", "palace", "grand", "new", "jass"]);
  for (const h of hotels) {
    const full = h.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const first = full.split(" ").find((w) => w.length >= 4 && !GENERIC_HOTEL.has(w));
    const alias = [escapeRe(full).replace(/ /g, "[\\s,.-]+"), ...(first ? [escapeRe(first)] : [])].join("|");
    const city = cityName(h.city.toLowerCase().trim());
    const N = NUM.slice(1, -1);
    const res = [
      new RegExp(`\\b(?<n>${N})\\s*(?:nights?|n)\\s+(?:stay\\s+|halt\\s+)?(?:in|at)\\s+(?:the\\s+)?(?:${alias})\\b`, "g"),
      new RegExp(`\\b(?:stay(?:ing)?|overnight)\\s+(?:in|at)\\s+(?:the\\s+)?(?:${alias})\\b[^.;]{0,30}?\\b(?:for\\s+)?(?<n>${N})\\s*nights?\\b`, "g"),
    ];
    for (const re of res) {
      for (const m of low.matchAll(re)) {
        if (taken(m)) continue;
        const when = m.index! < firstPark ? "before" : m.index! > lastPark ? "after" : null;
        if (!when || stays.some((x) => x.when === when && x.city === city)) continue;
        seen.push([m.index!, m.index! + m[0].length]);
        stays.push({ when, city, nights: toNum(m.groups!.n), hotel: h.name, at: m.index! } as (typeof stays)[number] & { at: number });
      }
    }
  }
  // "Delhi arrival 10 Feb, fly to Jabalpur next day": a night in the city they land in
  const nextDay = low.match(/\b(?:fly|flight|flying)\b[^.;]{0,40}?\bnext\s+day\b|\bnext\s+day\b[^.;]{0,20}?\b(?:fly|flight|flying)\b/);
  if (nextDay && flights.length && nextDay.index! < firstPark && !stays.some((s) => s.when === "before")) {
    stays.push({ when: "before", city: flights[0].from, nights: 1, at: nextDay.index! + nextDay[0].length } as (typeof stays)[number] & { at: number });
  }
  // "Delhi - Agra - Jaipur 4 nights by car": a touring package, not nights in one city. Asked.
  const chain = low.match(new RegExp(`\\b(${CITY_RE})\\s*(?:-|\\u2013|to)\\s*(${CITY_RE})\\s*(?:-|\\u2013|to)\\s*(${CITY_RE})\\b`));
  if (chain && chain.index! < firstPark) {
    const label = [chain[1], chain[2], chain[3]].map(cityName).join(" - ");
    const st = (stays as ((typeof stays)[number] & { at: number })[]).find((s) => s.when === "before" && s.at >= chain.index! && s.at <= chain.index! + chain[0].length + 10);
    if (st) {
      st.city = label;
      st.hotel = "Outstation package (to be confirmed)";
    }
    ask({
      key: "package",
      text: `"${label}${st ? `, ${st.nights} nights` : ""}" is a touring package. Which one (for example Delhi - Agra - Jaipur - Delhi, ${st ? `${st.nights} nights / ${st.nights + 1} days` : "4 nights / 5 days"}), and how many nights in each city?`,
    });
  }
  // in the order they are mentioned
  const staysAt = (stays as ((typeof stays)[number] & { at: number })[]).sort((a, b) => a.at - b.at);
  // what they want to do in a city: "Khajuraho 2 nights with sightseeing, guide and entrances"
  // (read up to the next city or park mentioned)
  const marks = [...staysAt.map((s) => s.at), ...parkHits.map((h) => h.index)].sort((a, b) => a - b);
  for (const s of staysAt) {
    const end = Math.min(marks.find((x) => x > s.at) ?? low.length, s.at + 200);
    const win = low.slice(s.at, end);
    const want: string[] = [];
    if (/\b(sight\s?seeing|sightseeings?|sighting|city tour|temple tour)\b/.test(win)) want.push("sightseeing");
    if (/\bguides?\b/.test(win)) want.push("guide");
    if (/\b(entrances?|entry|entries|tickets?|monument fees?)\b/.test(win)) want.push("entrance");
    if (want.length) s.want_extras = want;
  }
  if (stays.length) out.cityStays = staysAt.map(({ at: _at, ...c }) => c);
  // "Arriving Delhi on 15 Mar; Delhi 1 night; fly to Jabalpur...": a date written before the
  // city nights is the day they land in the city, so the first lodge is reached that many nights later.
  // (A date written after them, "reach Kanha on 16 Mar", is already the lodge date.)
  const firstBefore = staysAt.find((s) => s.when === "before");
  if (out.arrival_date && firstBefore && firstDateAt !== null && firstDateAt < firstBefore.at) {
    const lead = staysAt.filter((s) => s.when === "before").reduce((t, s) => t + s.nights, 0);
    const lodgeDay = addDays(out.arrival_date, lead);
    if (out.departure_date && out.departure_date <= lodgeDay) delete out.departure_date; // "reach Kanha on 16 Mar" as well
    out.arrival_date = lodgeDay;
  }
  // Hinglish "sab safari naturalist ke saath": every safari at every stop with a naturalist
  if (/\b(?:sab|saari|sabhi|all(?:\s+the)?|every)\s+safaris?\b[^.]{0,40}\bnaturalists?\b/.test(low) && !/\bnaturalists?\s+ke\s+bina\b/.test(low) && !/\bwithout\s+(?:an?\s+|the\s+)?naturalists?\b/.test(low)) {
    for (const p of out.parks) p.naturalists ??= -1;
  }
  if (/\b(reverse|opposite\s+(?:order|direction|way)|other\s+way\s+round|wrong\s+(?:direction|order)|the other way)\b/.test(low)) out.reverse = true;
  // "all stays they will do nature walk", "any special at each lodge"
  for (const m of low.matchAll(/\b(?:all|every|each)\s+(?:the\s+|of\s+the\s+)?(?:stays?|lodges?|places?|parks?|locations?)\b/g)) {
    const win = low.slice(m.index!, m.index! + 160); // only what follows "all stays ..."
    const extras = EXTRA_WORDS.filter(([re]) => re.test(win)).map(([, k]) => k);
    if (/\b(special|signature|unique|speciality|specialty)\b/.test(win)) extras.push("special");
    if (extras.length) for (const p of out.parks) p.extras = [...new Set([...(p.extras ?? []), ...extras])];
  }

  if (out.parks.length === 1 && !out.parks[0].nights && out.arrival_date && out.departure_date) {
    out.parks[0].nights = nightsBetween(out.arrival_date, out.departure_date);
  }

  // ---- arrival / departure places (codes like NAG and JLR count too)
  const rank: Record<string, number> = { airport: 0, railway: 1, city: 2, other: 3 };
  const places = ctx.locations.filter((l) => l.type !== "property").sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  const placeHits = findAll(text, places.map((l) => ({ name: l.name, aliases: locationAliases(l.name, l.code) })));
  const arriveWords =
    /(arriv\w*|arr\.?|land\w*|pick(?:ing)?[\s-]?up(?:\s+(?:from|at))?|from|ex|start\w*|reach\w*|coming (?:in )?(?:to|at)|aayenge|aaenge|aa rahe(?: hai)?|pahunch\w*)(?:\s+(?:by|in)\s+(?:train|flight|air|road|car))?\W*(?:at|in|to)?\W*$/i;
  const departWords =
    /(depart\w*|dep\.?|wapas|vapas|leav\w*|drop(?:ping)?(?:\s+off)?|fly(?:ing)?\s+(?:out|back)|back(?: to)?|out\s+(?:from|of|via)|end\w*|exit\w*|return\w*|onward|jayenge|jaenge|jaayenge|nikl\w*)\W*(?:at|in|to|from|via|of)?\W*$/i;
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
  // a place that is only named as a city stay ("1 night khajuraho" at the end) is not where they
  // arrive: the first city after the lodges is where the drive from the last lodge goes
  const stayCity = (name: string) => (out.cityStays ?? []).find((c) => name.toLowerCase().startsWith(c.city.toLowerCase()));
  const firstAfter = out.cityStays?.find((c) => c.when === "after");
  for (const name of unclassified) {
    const c = stayCity(name);
    if (c) {
      if (c === firstAfter && !out.departure_place && /airport/i.test(name)) out.departure_place = name;
      continue;
    }
    if (!out.arrival_place) out.arrival_place = name;
    else if (!out.departure_place) out.departure_place = name;
  }
  // "same airport": they leave from where they arrive (said, not assumed)
  if (out.arrival_place && !out.departure_place && /\bsame\s+(?:airport|place|station|city|point|way)\b/.test(low)) {
    out.departure_place = out.arrival_place;
    out.same_out = true;
  }
  if (out.arrival_place && !out.departure_place && placeHits.length === 1) {
    out.departure_place = out.arrival_place;
    out.notes.push(`Assumed the guest also leaves from ${out.arrival_place}.`);
  }

  // ---- how they travel: own vehicle, train, flight, our car. Each mention belongs to its own
  // part of the message: arriving ("coming by own car to Kanha"), leaving ("return by own car"),
  // a move between lodges ("then Pench 2n by our car"), else the whole trip ("bus own").
  const clauseOf = (at: number) => {
    const start = Math.max(...[",", ";", ".", "\n"].map((c) => low.lastIndexOf(c, at - 1))) + 1;
    const ends = [",", ";", ".", "\n"].map((c) => low.indexOf(c, at)).filter((x) => x >= 0);
    return { start, end: ends.length ? Math.min(...ends) : low.length };
  };
  const ARRIVE_V = /\b(?:arriv\w*|com(?:e|es|ing)|reach\w*|aayenge|aaenge|aa\s+rahe|pahunch\w*|pick\s?up|start\w*)\b/;
  const DEPART_V = /\b(?:return\w*|leav\w*|depart\w*|back|jayenge|jaenge|jaayenge|wapas|vapas|drop\w*|go(?:ing)?\s+(?:home|back)|exit\w*|nikl\w*)\b/;
  const direction = (at: number) => {
    const c = clauseOf(at);
    const words = low.slice(c.start, c.end);
    if (DEPART_V.test(words)) return "departure" as const;
    if (ARRIVE_V.test(words)) return "arrival" as const;
    // a later stop named in the same part: the move to it
    if (order.slice(1).some((o) => o.at >= c.start && o.at < c.end)) return "between" as const;
    return null;
  };
  const OWN_RE =
    /\b(?:own\s+(?:car|vehicle|cab|transport|bus|coach|gaadi|gadi)|self[- ]?driv\w*|apni\s+(?:gaadi|gadi|gari|car)|khud\s+ki\s+(?:car|gaadi|gadi)|their\s+(?:own\s+)?car|(?:bus|car|vehicle|coach|cab)\s+(?:is\s+)?(?:their\s+)?own)\b/g;
  for (const m of low.matchAll(OWN_RE)) {
    const d = direction(m.index!);
    if (d === "arrival") out.arrival_mode = "own";
    else if (d === "departure") out.departure_mode = "own";
    else if (d === "between") out.between = "own";
    else out.own_all = true;
  }
  for (const m of low.matchAll(/\b(?:by\s+our\s+(?:car|vehicle)|(?:in\s+)?our\s+(?:car|vehicle|transfer)|by\s+road)\b/g)) {
    if (direction(m.index!) === "between") out.between ??= "ours";
  }
  for (const m of low.matchAll(/\b(?:by\s+train|train\s+se|via\s+train|on\s+(?:the\s+)?train|train)\b/g)) {
    const d = direction(m.index!);
    if (d === "departure") out.departure_mode ??= "train";
    else if (d === "arrival") out.arrival_mode ??= "train";
  }
  for (const m of low.matchAll(/\b(?:flight\s+se|by\s+(?:flight|air)|fly(?:ing)?\s+(?:in|out|home))\b/g)) {
    const d = direction(m.index!);
    if (d === "departure") out.departure_mode ??= "flight";
    else if (d === "arrival") out.arrival_mode ??= "flight";
  }
  // came in their own car to the only lodge: they leave in it too
  if (out.arrival_mode === "own" && !out.departure_mode && out.parks.length <= 1) out.own_all = true;
  if (out.own_all) {
    out.arrival_mode = out.departure_mode = "own";
    out.between = "own";
  }
  if (out.arrival_mode === "own") delete out.arrival_place;
  if (out.departure_mode === "own") delete out.departure_place;
  // by train: the station of that city, by flight: its airport ("train se aayenge jabalpur")
  const kindFor = (mode?: TravelMode) => (mode === "train" ? "railway" : mode === "flight" ? "airport" : null);
  const swap = (name: string | undefined, mode?: TravelMode) => {
    const kind = kindFor(mode);
    const loc = name ? places.find((l) => l.name === name) : undefined;
    if (!kind || !loc || loc.type === kind) return name;
    const city = loc.name.toLowerCase().split(/[\s(]/)[0];
    const other = places.find((l) => l.type === kind && l.name.toLowerCase().startsWith(city));
    if (!other) out.notes.push(`There is no ${kind === "railway" ? "railway station" : "airport"} for ${cityName(city)} in Master data > Places; ${loc.name} is used. Add it there.`);
    return other?.name ?? name;
  };
  out.arrival_place = swap(out.arrival_place, out.arrival_mode);
  out.departure_place = swap(out.departure_place, out.departure_mode);

  // ---- special requests
  const requests = REQUESTS.filter(([re]) => re.test(low)).map(([, r]) => r);
  if (requests.length) out.requests = requests;

  // ---- parks that are not ours: said so, never a lodge made up
  const notOurs = OTHER_PARKS.filter(([re]) => re.test(low) && !ctx.pricing.parks.some((p) => re.test(p.name.toLowerCase()))).map(([, n]) => n);
  if (notOurs.length) out.notOurs = notOurs;

  const unknown = unknownWords(text, ctx, hotels);
  if (unknown.length) out.unknown = unknown;
  if (asks.length) out.asks = asks;
  return out;
}

const REQUESTS: [RegExp, string][] = [
  [/\bphotograph(?:er|ers|y|ic)\b|\bphoto\s*(?:tour|trip|safari)s?\b/, "photographers"],
  [/\bhoney\s?moon(?:ers?|ing)?\b/, "honeymoon"],
  [/\banniversary\b/, "anniversary"],
  [/\bbirthday\b|\bbday\b/, "birthday"],
  [/\bjain\b/, "Jain food"],
  [/(?<!non[- ]?)\b(?:pure\s+)?veg(?:etarian)?s?\b/, "vegetarian"],
  [/\belderly\b|\bsenior\s+citizens?\b|\b(?:old|aged)\s+(?:parents?|mother|father|couple)\b/, "elderly guests"],
  [/\bwheel\s?chairs?\b/, "wheelchair"],
  [/\bground\s+floor\b/, "ground floor room"],
];

// Parks people ask about that are not ours.
const OTHER_PARKS: [RegExp, string][] = [
  [/\branth?ambh?ore\b/, "Ranthambore"],
  [/\b(?:jim\s+)?corbett\b/, "Corbett"],
  [/\bsasan\s+gir\b|\bgir\s+(?:national\s+park|forest|np)\b/, "Gir"],
  [/\bsundarbans?\b/, "Sundarbans"],
  [/\bbandipur\b/, "Bandipur"],
  [/\bnagarhole\b|\bkabini\b/, "Nagarhole (Kabini)"],
  [/\bperiyar\b/, "Periyar"],
  [/\bkaziranga\b/, "Kaziranga"],
  [/\bsariska\b/, "Sariska"],
  [/\bbharatpur\b|\bkeoladeo\b/, "Bharatpur"],
  [/\bdudhwa\b/, "Dudhwa"],
  [/\bmelghat\b/, "Melghat"],
  [/\bnagzira\b/, "Nagzira"],
];

// ---------------------------------------------------------------- unknown words

// Words the reader understands without master data: English and Hindi travel words.
const KNOWN_WORDS = new Set(
  `a an the and or but if so to of in on at by for from with without into onto via per each every all any some no not nor only also too very just than then
  is are was were be been being am do does did done have has had having will would shall should can could may might must let lets get got
  i we you he she they it me us him her them my our your his their its this that these those there here what which who whom whose when where how why
  yes ok okay please pls plz thanks thank kindly dear hi hello sir madam team regards best
  one two three four five six seven eight nine ten eleven twelve first second third last next same other another both either more less most least few many
  adult adults pax people person persons guest guests traveller travellers traveler travelers ppl couple pair family group party solo single kid kids child children childs infant infants baby babies son daughter wife husband mother father mom dad parents parent friends friend
  yr yrs year years old age aged ages
  night nights nts day days week weeks month months weekend morning mornings evening evenings afternoon noon time date dates
  arrive arrives arriving arrival arrived reach reaching come comes coming came land landing pickup pick drop dropping depart departing departure leave leaving leaves return returning back out start starting end ending exit onward onwards
  flight flights fly flying flies flew airport airports train trains station railway road car cars vehicle vehicles cab bus coach jeep jeeps gypsy drive driving self transfer transfers transport own way
  stay stays staying overnight spend spending halt lodge lodges hotel hotels resort camp room rooms cottage cottages suite suites tree house houses villa tent bungalow double twin triple deluxe standard luxury separate floor ground
  park parks national tiger reserve sanctuary forest jungle wildlife zone core buffer safari safaris game naturalist naturalists guide guides walk walking nature trail village visit boat canoe canoeing night cruise ride picnic dinner bush lunch breakfast meal meals board full half plan veg vegetarian food special specials signature experience experiences activity activities
  sightseeing city tour tours temple temples entrance entrances entry ticket tickets monument monuments
  need needs needed want wants wanted like would prefer require required request requests requested looking look plan planning planned quote quotes quotation package itinerary trip tour holiday vacation booking book booked confirm confirmed check
  indian indians foreign foreigner foreigners foreign nationals national nri domestic international overseas resident
  include included including inclusive exclusive extra option options possible available please also around about approx approximately till until upto up before after during between instead remove add change make keep
  honeymoon anniversary birthday elderly senior citizen citizens wheelchair photographer photographers photography camera cameras fishing angling
  wrong right correct reverse opposite order direction instead place places stop stops location locations
  ap map cp ep am pm hrs jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december
  log logon bande aadmi bacche bachche bachhe bachon bacchon raat raate raaten raatein din ko se ka ki ke hai hain tha the aa rahe aayenge aaenge jayenge jaenge jaayenge wapas vapas phir pehle baad uske uske saath sath sab saari sabhi chahiye chaiye karo karna kar do dena hata hatao nikal nikalo apni apna khud gaadi gadi gari aur ya bhi nahi nhi mein me par pe tak liye wala wali wale accha theek thik ji
  ek teen char chaar panch paanch chhe chhah saat aath nau das`.split(/\s+/).filter(Boolean)
);

// Words and short phrases the reader could not place: logged so an admin can teach them.
// Names are left out: a word written with a capital letter (not a code like "THH") is
// taken to be a name, and so are words after Mr / Mrs.
export function unknownWords(text: string, ctx: BuilderContext, hotels: { name: string }[] = []): string[] {
  const known = new Set(KNOWN_WORDS);
  const names = [
    ...ctx.pricing.parks.map((p) => p.name),
    ...ctx.properties.map((p) => p.name),
    ...ctx.locations.map((l) => `${l.name} ${l.code ?? ""}`),
    ...ctx.rooms.map((r) => r.name),
    ...ctx.pricing.addons.map((a) => a.name),
    ...hotels.map((h) => h.name),
    ...CITIES,
    ...Object.keys(ABBREVIATIONS),
    ...Object.keys(MONTHS),
    ...(ctx.readerRules ?? []).map((r) => r.phrase),
  ];
  for (const n of names) for (const w of n.toLowerCase().split(/[^a-z]+/)) if (w) known.add(w);
  const clean = text.replace(/\b(?:mr|mrs|ms|miss|dr)\.?\s+[A-Za-z][a-zA-Z'-]*(?:\s+[A-Z][a-zA-Z'-]*)?/gi, " ");
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(run.join(" "));
    run = [];
  };
  for (const m of clean.matchAll(/[A-Za-z]+(?:'[a-z]+)?|[^A-Za-z\s]+/g)) {
    const word = m[0];
    if (!/^[A-Za-z]/.test(word)) {
      if (!/^\d+[a-z]*$/i.test(word)) flush();
      continue;
    }
    const w = word.toLowerCase().replace(/'s$/, "");
    const isName = /^[A-Z][a-z]/.test(word) && m.index! > 0 && !/[.!?]\s*$/.test(clean.slice(0, m.index!));
    const ok = w.length < 3 || known.has(w) || known.has(w.replace(/s$/, "")) || /^\d/.test(w) || /^(\d+)?(?:n|d|x|st|nd|rd|th)$/.test(w) || !!findCountry(word);
    if (ok || isName) {
      flush();
      continue;
    }
    run.push(w);
    if (run.length === 3) flush();
  }
  flush();
  return [...new Set(out)].slice(0, 12);
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
    // lodge nights plus city nights after them (the departure date is at the end of the trip)
    const planned = stops.reduce((t, s) => t + s.nights, 0) + (parsed.cityStays ?? []).filter((c) => c.when === "after").reduce((t, c) => t + c.nights, 0);
    const asked = nightsBetween(next.arrival_date, parsed.departure_date);
    if (asked !== planned) parsed.notes.push(`The dates give ${asked} nights but the parks add up to ${planned}. Check the nights.`);
  }

  return { plan: next, understood, missing: [...missing, ...parsed.notes] };
}

// Text safe to send to an outside AI: no emails, phone numbers or long digit runs,
// and no guest names: written as "Mr X" / "name is X", or the name typed in the
// guest fields (passed in as `names`), in full or any part of 3+ letters.
export function scrubForAI(text: string, names: string[] = []) {
  const parts = names
    .flatMap((n) => [n.trim(), ...n.split(/[^\p{L}'-]+/u)])
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && !/^(mr|mrs|ms|miss|dr|prof|and|family)$/i.test(p))
    .sort((a, b) => b.length - a.length); // the full name before its parts
  for (const p of [...new Set(parts)]) {
    text = text.replace(new RegExp(`(?<![\\p{L}])${escapeRe(p)}(?:'?s)?(?![\\p{L}])`, "giu"), "[guest]"); // also "Kapoors", "Kapoor's"
  }
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[number]")
    .replace(/\b(?:[Mm](?:r|rs|s|iss)|[Dd]r|[Pp]rof)\.?\s+(?:&\s*(?:[Mm]rs?)\.?\s+)?[A-Za-z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/g, "[guest]")
    .replace(/\b(?:guest(?:'s)?\s+name|name)\s*(?:is|:|-)\s*[^,.;\n]{2,60}/gi, "name: [guest]")
    .slice(0, 2000);
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

