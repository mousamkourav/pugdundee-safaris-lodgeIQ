// The guest-facing sections of an itinerary (title, intro, inclusions,
// exclusions, notes, terms). Shared by the builder's Final draft step and the
// public client page, so both always show the same text.
import type { CancellationSlab, ContentBlock, Plan, PlanDraft, PlanItem } from "./types";
import type { ParkClosure } from "@/lib/sales/pricing/types";
import { addDays } from "@/lib/sales/pricing/dates";

export interface DraftSections {
  title: string; // the catchy headline on the cover
  routeLine: string; // "Satpura, Pench, Kanha, Bandhavgarh & Tadoba"
  about: string;
  inclusions: string[];
  exclusions: string[];
  notes: string[];
  paymentTerms: string;
  cancellation: string[];
}

export interface DraftInputs {
  parkNames: Record<string, string>;
  lodgeNames: Record<string, string>;
  blocks: ContentBlock[];
  cancellationSlabs: CancellationSlab[];
  closures?: ParkClosure[]; // park closures, for "Good to know"
  today?: string; // for itineraries without dates: which closures are still ahead
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.replace(/^[-*\u2022]\s*/, "").trim())
    .filter(Boolean);


// ---------------------------------------------------------------- near-copies and order

const STOP = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "at", "as", "per", "with", "for", "to", "by", "is", "are", "be", "all", "any", "if", "our", "your", "we", "you", "it", "its", "this", "that", "etc", "shown"]);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const wordsOf = (s: string) => [...new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map(stem))];
// Names, days and numbers: a line is only a copy of another if it has the same ones
// ("Tadoba ... Tuesdays" is not a copy of "Bandhavgarh ... Wednesday").
const keysOf = (s: string) =>
  wordsOf(
    s
      .split(/\s+/)
      .slice(1)
      .filter((w) => /^[A-Z0-9]/.test(w))
      .join(" ")
  );

// Drops repeated lines and near-copies: a line whose words are (almost) all in a line
// already kept, with the same names and numbers. The first one stays.
export function dedupeLines(xs: string[]): string[] {
  const kept: { text: string; words: string[] }[] = [];
  for (const x of xs) {
    const text = x.trim();
    if (!text) continue;
    const words = wordsOf(text);
    const keys = keysOf(text);
    const copy = kept.some((k) => {
      const inK = words.filter((w) => k.words.includes(w)).length;
      return (words.length ? inK / words.length >= 0.8 : text.toLowerCase() === k.text.toLowerCase()) && keys.every((w) => k.words.includes(w));
    });
    if (!copy) kept.push({ text, words });
  }
  return kept.map((k) => k.text);
}

// The mobile-phone rule, however it is worded ("Mobile phones are strictly not allowed",
// "Cell phones are prohibited", "No phones in the park").
export const isPhoneRule = (s: string) =>
  /\b(mobile|cell(ular)?|smart)\s*-?\s*phones?\b/i.test(s) || /\bphones?\b[^.]*\b(not allowed|not permitted|prohibited|banned)\b/i.test(s) || /\bno\s+(mobile|phones?)\b/i.test(s);
// ...always the first point of the list it is in
export const phoneRuleFirst = (xs: string[]) => [...xs].sort((a, b) => Number(!isPhoneRule(a)) - Number(!isPhoneRule(b)));

const MEALS_LINE: Record<string, string> = {
  AP: "All meals (breakfast, lunch and dinner)",
  MAP: "Breakfast and dinner",
  CP: "Breakfast",
  EP: "Room only (no meals)",
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const readable = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const FLIGHT_BAGGAGE = "check-in baggage 15 kgs / cabin baggage 07 kgs";
const isPricedFlight = (it: PlanItem) => it.type === "flight" && (!!it.price || !!it.flight?.fare_pp);

// "Domestic flights Delhi-Nagpur and Jabalpur-Delhi in economy class (check-in baggage 15 kgs / cabin baggage 07 kgs)"
export function flightsLine(plan: Plan) {
  const legs = plan.days.flatMap((d) => (d.items ?? []).filter(isPricedFlight)).map((it) => it.flight!).filter((f) => f.from && f.to);
  if (!legs.length) return null;
  const chains: string[][] = [];
  for (const f of legs) {
    const last = chains[chains.length - 1];
    if (last && last[last.length - 1].toLowerCase() === f.from.toLowerCase()) last.push(f.to);
    else chains.push([f.from, f.to]);
  }
  const cabin = (legs.find((f) => f.cabin)?.cabin || "economy").toLowerCase();
  const baggage = legs.find((f) => f.baggage)?.baggage || FLIGHT_BAGGAGE;
  return `Domestic flights ${joinAnd(chains.map((c) => c.join("-")))} in ${cabin} class (${baggage})`;
}

// Includes / does not include, from what this itinerary has: the meal plans,
// safaris, naturalists, transfers, flights and experiences.
function standardLists(plan: Plan, lodgeNames: Record<string, string>) {
  const inc: string[] = ["Stay in well-appointed rooms with attached facilities"];
  const exc: string[] = [];

  const byMeal = new Map<string, string[]>();
  for (const s of plan.stops) {
    const name = lodgeNames[s.property_id];
    if (!name) continue;
    const list = byMeal.get(s.meal_plan) ?? [];
    if (!list.includes(name)) list.push(name);
    byMeal.set(s.meal_plan, list);
  }
  const cities = (plan.city_stays ?? []).filter((c) => c.nights > 0);
  if (byMeal.size === 1 && !cities.length) {
    const m = [...byMeal.keys()][0];
    inc.push(m === "AP" ? "All meals: breakfast, lunch and dinner" : `Meals: ${(MEALS_LINE[m] ?? m).toLowerCase()}`);
  } else {
    for (const [m, lodges] of byMeal) inc.push(`${MEALS_LINE[m] ?? m} at ${joinAnd(lodges)}`);
    for (const c of cities) if (c.hotel || c.city) inc.push(`Meals at ${c.hotel || "the hotel"}${c.city ? ` in ${c.city}` : ""} as per the hotel's meal plan`);
  }

  // lines that depend on this itinerary (also added to the Master data lists)
  const itineraryInc: string[] = [];
  const itineraryExc: string[] = [];
  const safaris = plan.days.flatMap((d) => d.safaris);
  if (safaris.length) inc.push("Jeep safaris as shown, with permit fee, jeep, park guide, packed breakfast on morning safaris and refreshments on evening safaris");
  if (safaris.some((x) => x.naturalist)) itineraryInc.push("Accompanying lodge naturalist on the safaris shown");
  else if (safaris.length) itineraryExc.push("Accompanying lodge naturalist on safaris");
  if (plan.own_vehicle) itineraryExc.push("Transfers: the guests travel in their own vehicle");
  else if (plan.days.some((d) => d.transfer || d.city_transfers?.length)) inc.push("Road transfers shown in the itinerary");

  const flights = flightsLine(plan);
  if (flights) itineraryInc.push(flights);
  else itineraryExc.push("Flights and train tickets");

  const items = plan.days.flatMap((d) => d.items ?? []);
  if (items.some((it) => it.type === "addon" || (it.type === "activity" && it.price))) itineraryInc.push("Experiences and activities shown in the itinerary");
  inc.push(...itineraryInc);
  exc.push(...itineraryExc);
  inc.push("Currently applicable taxes");

  exc.push(
    "Any expense of personal nature (soft or hard beverages, laundry, phone calls etc)",
    "Tips & gratuities (entirely as per your discretion \u2013 we do not levy service charge in our bills)",
    "Anything not listed in includes section"
  );
  return { inc, exc, itineraryInc, itineraryExc };
}

// "Good to know" lines about park closures, for the parks in this itinerary only,
// naming them; closures on dates (festivals, monsoon) only if they fall in the trip.
export function closureNotes(plan: Plan, inp: Pick<DraftInputs, "parkNames" | "closures" | "today">): string[] {
  const parkIds = [...new Set(plan.stops.map((s) => s.park_id))];
  const closures = (inp.closures ?? []).filter((c) => parkIds.includes(c.park_id));
  if (!closures.length) return [];
  const parksText = (ids: string[]) => {
    const names = ids.map((id) => shortPark(inp.parkNames[id] ?? "")).filter(Boolean);
    return `${joinAnd(names)} National Park${names.length === 1 ? "" : "s"}`;
  };
  const sessionText: Record<string, string> = { morning: "morning safaris", afternoon: "afternoon safaris", full_day: "the full day" };
  const out: string[] = [];

  // weekly closures, the same rule for several parks in one line
  const weekly = new Map<string, string[]>();
  for (const c of closures.filter((x) => x.closure_type === "weekly" && x.weekday != null)) {
    const k = `${c.zone}|${c.session}|${c.weekday}`;
    const ids = weekly.get(k) ?? [];
    if (!ids.includes(c.park_id)) ids.push(c.park_id);
    weekly.set(k, ids);
  }
  const ordered = (ids: string[]) => parkIds.filter((id) => ids.includes(id));
  for (const [k, ids] of weekly) {
    const [zone, session, wd] = k.split("|");
    const day = WEEKDAYS[Number(wd)];
    const parks = parksText(ordered(ids));
    if (zone === "core" && session === "full_day") out.push(`Core zones of ${parks} remain closed for the full day on ${day}s but buffer safaris remain operational.`);
    else if (zone === "core")
      out.push(`Core zones of ${parks} remain closed for ${sessionText[session]} on each ${day} but buffer safaris remain operational. We can plan the dates in a way that this day is used for travel or else a buffer safari can be availed.`);
    else if (zone === "buffer") out.push(`Buffer zones of ${parks} remain closed for ${sessionText[session]} on ${day}s.`);
    else out.push(`${parks} remain${ids.length === 1 ? "s" : ""} closed for ${sessionText[session]} on ${day}s.`);
  }

  // closures on dates: only those during the trip (dates not fixed: those still ahead)
  const from = plan.dateless ? inp.today ?? plan.arrival_date : plan.days[0]?.date ?? plan.arrival_date;
  const to = plan.dateless ? addDays(from, 400) : plan.days[plan.days.length - 1]?.date ?? from;
  const dated = closures.filter((c) => c.closure_type === "date_range" && c.date_from && c.date_to && c.date_to >= from && c.date_from <= to);
  // one-day festivals for the same parks in one line: "on Diwali (8 Nov 2026) and Holi (22 Mar 2027)"
  const festivals = new Map<string, { parks: string[]; zone: string; session: string; days: { label: string; date: string }[] }>();
  const ranges: typeof dated = [];
  for (const c of dated) {
    if (c.date_from !== c.date_to) {
      ranges.push(c);
      continue;
    }
    const day = { label: c.label || "", date: c.date_from! };
    const k = `${c.zone}|${c.session}|${day.label}|${day.date}`;
    const f = festivals.get(k) ?? { parks: [], zone: c.zone, session: c.session, days: [day] };
    if (!f.parks.includes(c.park_id)) f.parks.push(c.park_id);
    festivals.set(k, f);
  }
  const byParks = new Map<string, { parks: string[]; zone: string; session: string; days: { label: string; date: string }[] }>();
  for (const f of festivals.values()) {
    const k = `${ordered(f.parks).join(",")}|${f.zone}|${f.session}`;
    const g = byParks.get(k) ?? { parks: ordered(f.parks), zone: f.zone, session: f.session, days: [] };
    g.days.push(...f.days);
    byParks.set(k, g);
  }
  for (const g of byParks.values()) {
    const days = joinAnd(g.days.sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => (d.label ? `${d.label} (${readable(d.date)})` : readable(d.date))));
    const zone = g.zone === "core" ? "Core zones of " : g.zone === "buffer" ? "Buffer zones of " : "";
    out.push(`${zone}${parksText(g.parks)} remain${g.parks.length === 1 && !zone ? "s" : ""} closed for ${sessionText[g.session] ?? "the full day"} on ${days}.`);
  }
  const rangeGroups = new Map<string, { parks: string[]; c: ParkClosure }>();
  for (const c of ranges) {
    const k = `${c.zone}|${c.session}|${c.date_from}|${c.date_to}|${c.label ?? ""}`;
    const g = rangeGroups.get(k) ?? { parks: [], c };
    if (!g.parks.includes(c.park_id)) g.parks.push(c.park_id);
    rangeGroups.set(k, g);
  }
  for (const { parks, c } of rangeGroups.values()) {
    const zone = c.zone === "core" ? "Core zones of " : c.zone === "buffer" ? "Buffer zones of " : "";
    const after = c.zone === "core" ? "; buffer safaris continue" : "";
    out.push(`${zone}${parksText(ordered(parks))} ${zone || parks.length > 1 ? "are" : "is"} closed from ${readable(c.date_from!)} to ${readable(c.date_to!)}${c.label ? ` (${c.label})` : ""}${after}.`);
  }
  return out;
}

// "Tadoba-Andhari Tiger Reserve" -> "Tadoba", "Pench National Park" -> "Pench"
export const shortPark = (name: string) =>
  name
    .replace(/\b(national park|tiger reserve|wildlife sanctuary|sanctuary|reserve forest)\b/gi, "")
    .replace(/-andhari/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const HEADLINES = [
  "Into the Heart of Tiger Country",
  "On the Trail of the Tiger",
  "Where the Wild Tigers Roam",
  "Journey Through Tiger Country",
  "Footprints in the Sal Forest",
  "Tigers, Forests and Starlit Nights",
];

// The same headline every time for a given route (it can be changed on Final draft).
export function headlineFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HEADLINES[h % HEADLINES.length];
}

export function defaultDraft(plan: Plan, inp: DraftInputs): DraftSections {
  const parkIds = [...new Set(plan.stops.map((s) => s.park_id))];
  const lodgeIds = [...new Set(plan.stops.map((s) => s.property_id))];
  const parks = parkIds.map((id) => inp.parkNames[id]).filter(Boolean);
  const lodges = lodgeIds.map((id) => inp.lodgeNames[id]).filter(Boolean);
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);

  // The generic block of a kind (default first), plus blocks for these parks/lodges.
  const textsFor = (kind: string) => {
    const generic = inp.blocks.filter((b) => b.kind === kind && !b.park_id && !b.property_id);
    const main = generic.find((b) => b.is_default) ?? generic[0];
    const specific = inp.blocks.filter(
      (b) => b.kind === kind && ((b.park_id && parkIds.includes(b.park_id)) || (b.property_id && lodgeIds.includes(b.property_id)))
    );
    return [main, ...specific].filter((b): b is ContentBlock => !!b).map((b) => b.body);
  };

  // Includes / does not include: the lists in Master data > Content when there are any,
  // plus only the lines that depend on this itinerary (flights, naturalists, experiences);
  // without them, the standard lists written from the itinerary. Never a line twice.
  const standard = standardLists(plan, inp.lodgeNames);
  const masterInc = textsFor("inclusions").flatMap(lines);
  const masterExc = textsFor("exclusions").flatMap(lines);
  const inclusions = phoneRuleFirst(dedupeLines(masterInc.length ? [...masterInc, ...standard.itineraryInc] : standard.inc));
  const exclusions = phoneRuleFirst(dedupeLines(masterExc.length ? [...masterExc, ...standard.itineraryExc] : standard.exc));
  const cancellation = phoneRuleFirst(dedupeLines(textsFor("cancellation_terms").flatMap(lines)));

  return {
    title: parks.length ? headlineFor(parkIds.join("|")) : "Your safari",
    routeLine: (() => {
      const names = [...new Set(parks.map(shortPark))];
      return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0] ?? "";
    })(),
    about:
      textsFor("about_trip")[0] ??
      (nights
        ? (() => {
            const shortParks = [...new Set(parks.map(shortPark))];
            const parkList = shortParks.length > 1 ? `${shortParks.slice(0, -1).join(", ")} and ${shortParks[shortParks.length - 1]}` : shortParks[0];
            const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
            const stay = lodges.length <= 3 ? lodges.join(lodges.length === 2 ? " and " : ", ") : `${words[lodges.length] ?? lodges.length} of our handpicked wildlife lodges`;
            return `A ${nights}-night journey through ${parkList}, staying at ${stay}.`;
          })()
        : ""),
    inclusions,
    exclusions,
    // closures for these parks first (generated from Master data > Park closures), then park / lodge notes, then the general notes
    notes: (() => {
      const generic = inp.blocks.filter((b) => b.kind === "important_notes" && !b.park_id && !b.property_id);
      const main = generic.find((b) => b.is_default) ?? generic[0];
      const specific = inp.blocks.filter(
        (b) => b.kind === "important_notes" && ((b.park_id && parkIds.includes(b.park_id)) || (b.property_id && lodgeIds.includes(b.property_id)))
      );
      return phoneRuleFirst(dedupeLines([...closureNotes(plan, inp), ...specific.flatMap((b) => lines(b.body)), ...(main ? lines(main.body) : [])]));
    })(),
    paymentTerms: textsFor("payment_terms").join("\n"),
    cancellation: cancellation.length
      ? cancellation
      : inp.cancellationSlabs
          .slice()
          .sort((a, b) => a.min_days - b.min_days)
          .map((c) =>
            c.max_days == null
              ? `${c.min_days} days or more before arrival: ${c.pct}% of the total`
              : c.min_days === 0
                ? `${c.max_days} days or less before arrival: ${c.pct}% of the total`
                : `${c.min_days} to ${c.max_days} days before arrival: ${c.pct}% of the total`
          ),
  };
}

// Apply what the sales member edited on the Final draft step.
export function withEdits(def: DraftSections, draft?: PlanDraft): DraftSections {
  if (!draft) return def;
  return {
    ...def,
    title: draft.title?.trim() || def.title,
    routeLine: draft.subtitle?.trim() || def.routeLine,
    about: draft.about !== undefined ? draft.about : def.about,
    inclusions: draft.inclusions ? phoneRuleFirst(dedupeLines(draft.inclusions)) : def.inclusions,
    exclusions: draft.exclusions ? phoneRuleFirst(dedupeLines(draft.exclusions)) : def.exclusions,
    notes: draft.notes ? phoneRuleFirst(dedupeLines(draft.notes)) : def.notes,
  };
}
