// =====================================================================
// The AI side of the trip assistant (pure functions, no network here).
//   buildPrompt  - what Gemini is told: your parks, lodges, rooms, places,
//                  experiences, glossary, similar past enquiries, the trip so far
//   aiToParsed   - Gemini's JSON turned into a ParsedTrip, keeping only names
//                  that exist in master data and numbers in sensible ranges
//   (merging with the built-in reader: reading.ts, fillGaps - the AI fills gaps only)
//   similarExamples / planToExample - "learning" from quotes already made
// =====================================================================

import { EXTRA_WORDS, REQUESTS, aliasesOf, locationAliases, matchByName, scrubForAI, type Ask, type ParsedTrip, type RoomWish } from "./parse-text";
import type { BuilderContext, Plan, TravelMode } from "./types";
import { cityHotels, safariOnly } from "./cities";
import { formExperiences } from "./form";
import { roomLabel } from "./room-mix";

export const EXTRA_KEYWORDS = [...new Set(EXTRA_WORDS.map(([, k]) => k)), "special"];
const ROOMS: RoomWish[] = ["cottage", "tree", "suite", "deluxe"];
const MODES: TravelMode[] = ["flight", "train", "own", "transfer"];
export const REQUEST_NAMES = REQUESTS.map(([, name]) => name);
const requestsOf = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).filter((r): r is string => typeof r === "string" && REQUEST_NAMES.includes(r)))];

export interface Example {
  message: string;
  expected: string; // JSON in the same shape the AI answers in
}
export interface GlossaryRow {
  term: string;
  meaning: string;
}

// ---------------------------------------------------------------- prompt
export function catalogText(full: BuilderContext): string {
  const ctx = safariOnly(full);
  const lines: string[] = [];
  for (const park of ctx.pricing.parks) {
    const lodges = ctx.properties.filter((l) => l.park_id === park.id);
    if (!lodges.length) continue;
    const ls = lodges.map((l) => {
      const rooms = ctx.rooms.filter((r) => r.property_id === l.id).map((r) => r.name);
      // the lodge's experiences (its own add-ons, its park's, the Pugdundee-wide ones it offers)
      const exp = formExperiences(full, l.id).map((a) => a.name).slice(0, 10);
      return `${l.name}${rooms.length ? ` (rooms: ${rooms.join(", ")})` : ""}${exp.length ? ` [experiences: ${exp.join(", ")}]` : ""}`;
    });
    lines.push(`- ${park.name}: ${ls.join("; ")}`);
  }
  const places = ctx.locations.filter((l) => l.type !== "property").map((l) => l.name);
  const hotels = cityHotels(full).map((h) => `${h.name} (${h.city})`);
  return [`PARKS AND LODGES:`, ...lines, ...(hotels.length ? [`CITY HOTELS (only for city_stays "hotel", never a stop): ${hotels.join("; ")}`] : []), `ARRIVAL / DEPARTURE PLACES: ${places.join("; ")}`].join("\n");
}

export function planSummary(plan: Plan, ctx: BuilderContext): string {
  if (!plan.stops.length) return "No trip yet.";
  const park = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? id;
  const lodge = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? id;
  const loc = (id: string | null) => (id ? ctx.locations.find((l) => l.id === id)?.name ?? "?" : "on their own");
  const stops = plan.stops.map((s, i) => `${i + 1}. ${park(s.park_id)} at ${lodge(s.property_id)}, ${s.nights} nights`).join("; ");
  return [
    `Guests: ${plan.guest.adults} adults${plan.guest.children.length ? `, children aged ${plan.guest.children.join(", ")}` : ""}, ${plan.guest.rooms} rooms${plan.guest.country ? `, from ${plan.guest.country}` : ""}.`,
    `Arrival ${plan.arrival_date} via ${loc(plan.arrival_location_id)}; leaving via ${loc(plan.departure_location_id)}.`,
    `Stops: ${stops}.`,
    plan.city_stays?.length ? `City nights: ${plan.city_stays.map((c) => `${c.nights} in ${c.city} ${c.when}`).join("; ")}.` : "",
    plan.flights?.length ? `Flights: ${plan.flights.map((f) => `${f.from} to ${f.to}`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildPrompt(input: {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  plan: Plan;
  ctx: BuilderContext;
  glossary: GlossaryRow[];
  examples: Example[]; // similar enquiries this team quoted (Reading memory), with the trip that was quoted
  today: string;
}): string {
  const { ctx } = input;
  return [
    "You help a safari company's sales team turn a guest enquiry into a trip. Read the LAST MESSAGE (in the light of the conversation and the trip so far) and answer with JSON only.",
    "The team writes quickly, often in broken English, with spelling mistakes, Hindi or Hinglish words (raat = night, din = day, log / pax / bande = people, bacche = children, saal = years old, phir / fir = then, wapas = back, aur = and). Understand the meaning.",
    `Today is ${input.today}. Dates are YYYY-MM-DD; a date without a year is the next one in the future.`,
    "",
    catalogText(ctx),
    `EXPERIENCE KEYWORDS (use only these): ${EXTRA_KEYWORDS.join(", ")}. "special" means the lodge's own special experiences.`,
    `SPECIAL REQUESTS (use only these): ${REQUEST_NAMES.join(", ")}.`,
    input.glossary.length ? `TEAM GLOSSARY:\n${input.glossary.map((g) => `- ${g.term} = ${g.meaning}`).join("\n")}` : "",
    "",
    "EVIDENCE RULE (the most important rule): every value you give is an object {\"value\": ..., \"quote\": \"...\"} where quote is the EXACT words of the LAST MESSAGE that say it (copy them as written, a few words, e.g. \"kanha 2 raat\", \"bacche 7 aur 12 saal\", \"from France\").",
    "If no words of the message say a value, leave it out (null or an empty array). A value whose quote is not in the message, or does not say that value, is thrown away.",
    "Never choose a lodge, a room, a number of nights, safaris or ages the message does not state. Never fill a value from the trip so far or from the examples.",
    "",
    "RULES:",
    "- Copy park, lodge, room and place names EXACTLY from the lists (the quote is what the message wrote, e.g. value \"Kanha National Park\", quote \"kanha 3n\"). Never invent one.",
    '- "lodge": only when the message names the lodge. Never choose one yourself, even where a park has only one or two lodges.',
    '- "3 days" at a lodge means 3 nights (quote "3 days"). A second lodge in the same park is a separate stop.',
    '- arrival_date is the day they reach the FIRST LODGE: with city nights before it ("20 Apr 1 night Delhi, fly to Jabalpur"), the date after those nights.',
    "- arrival_place is where the road transfer to the first lodge starts (after any flight). departure_place is where the guests leave from at the end (before any flight).",
    "- Cities like Delhi are not stops: nights there go in city_stays, in travel order (when \"before\" the first lodge or \"after\"; at = how many lodges come before it). Flights go in flights.",
    "- safaris = jeep safaris wanted at that stop; naturalists = how many of them with a naturalist (-1 = all, quote e.g. \"all safaris with naturalist\"). A boat safari is an experience, not a jeep safari.",
    '- room: "cottage", "tree" (tree house), "suite" (forest suite) or "deluxe" (deluxe room), only when said.',
    '- arrival_mode / departure_mode: "flight", "train", "own" (their own vehicle) or "transfer" (our car); between: "own" or "ours" (between the lodges); own_all: true for their own vehicle all the way.',
    '- For a change to the trip so far ("make Pench 2 nights", "add Kanha"), give only what changes. For a whole new route, replace_route {"value": true, "quote": "..."}.',
    '- "wrong direction" / "reverse" -> reverse. A new order -> order (park names in the new order). Taking a park out -> remove_parks.',
    '- Travel dates not fixed yet ("dates not fixed", "dates are not fixed yet", "proceed without date", "no dates yet"): dateless V(true). Never invent a date.',
    '- A break from our itinerary ("they go to another resort for 2 days and resume with us", "2 nights on their own", "not with us for 3 nights"): breaks [{"at": how many lodges come before it, "nights": V(n), "quote": "the words that say the break"}]. Not a city stay, not a stop.',
    '- end_city: the city the trip ends in by road after the last stay ("drive back to Delhi for the flight home", "back to delhi and they will fly to USA").',
    "- A wish written once for the whole trip (\"they will do safaris with naturalists\", \"all the unique experiences that we offer like cycling, walking\"): trip_wide {\"naturalists\": V(-1), \"extras\": [V(keyword)]} (\"special\" for the lodges' own experiences, \"nature walk\" for walking). Never put it in one stop only.",
    '- Two lodges in one park ("bandhavgarh 4 nights: 2 nights kings, 2 nights tree house"): two stops, each with its own lodge and nights; the total is not a stop.',
    '- Several cities with one length ("agra and jaipur for 4 days"): each city its own city_stay, in order, WITHOUT nights (the nights are split by the team).',
    '- Every place and every "N nights / N days" of the message must be somewhere in your answer: a stop, a city stay, a flight, a break or end_city. Read the whole message to the end; long enquiries name 10 or more places.',
    "",
    "JSON (every V is {\"value\": ..., \"quote\": \"...\"}; leave out what the message does not say):",
    '{"replace_route": V(true), "adults": V(n), "children_ages": V([n]), "rooms": V(n), "country": V("ISO2"), "nationality": V("indian"|"foreign"),',
    ' "arrival_date": V("YYYY-MM-DD"), "arrival_place": V(name), "departure_place": V(name), "meal_plan": V("AP"|"MAP"|"CP"|"EP"),',
    ' "arrival_mode": V(mode), "departure_mode": V(mode), "between": V("own"|"ours"), "own_all": V(true), "requests": [V(request)],',
    ' "stops": [{"park": V(name), "lodge": V(name), "nights": V(n), "room": V("cottage"|"tree"|"suite"|"deluxe"), "safaris": V(n), "naturalists": V(n), "extras": [V(keyword)]}],',
    ' "city_stays": [{"when": "before"|"after", "at": n, "city": V(city), "nights": V(n), "hotel": V(name)}],',
    ' "flights": [{"from": city, "to": city, "time": "HH:MM", "quote": "the words that say this flight"}],',
    ' "remove_parks": [V(name)], "order": V([name]), "reverse": V(true),',
    ' "dateless": V(true), "end_city": V(city), "breaks": [{"at": n, "nights": V(n), "quote": "..."}], "trip_wide": {"naturalists": V(-1), "extras": [V(keyword)]}}',
    "",
    input.examples.length
      ? `SIMILAR ENQUIRIES THIS TEAM HAS QUOTED (for understanding only; the values and quotes still come from the LAST MESSAGE):\n${input.examples.map((e) => `Enquiry: ${e.message}\nQuoted as: ${e.expected}`).join("\n\n")}`
      : "",
    "",
    `TRIP SO FAR: ${planSummary(input.plan, ctx)}`,
    input.history.length ? `CONVERSATION:\n${input.history.map((h) => `${h.role === "user" ? "Sales" : "Assistant"}: ${scrubForAI(h.text, [input.plan.guest.name]).slice(0, 400)}`).join("\n")}` : "",
    "",
    `LAST MESSAGE: ${scrubForAI(input.message, [input.plan.guest.name])}`,
  ]
    .filter((x) => x !== "")
    .join("\n");
}

// ---------------------------------------------------------------- answer -> ParsedTrip
const int = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function aiToParsed(raw: unknown, full: BuilderContext): ParsedTrip {
  const ctx = safariOnly(full); // a city or a city hotel is never a safari stop
  const o = obj(raw);
  const parkOf = (name: unknown) => {
    const n = str(name);
    return n ? matchByName(ctx.pricing.parks, n, aliasesOf) : null;
  };
  const places = ctx.locations.filter((l) => l.type !== "property");
  const placeOf = (name: unknown) => {
    const n = str(name);
    return n ? matchByName(places, n, (x: string) => locationAliases(x)) : null;
  };
  const parks: ParsedTrip["parks"] = [];
  // a name that is not in master data is dropped and asked about, never guessed
  const asks: Ask[] = [];
  const unknownName = (name: string, what: string) => {
    const key = `unknown:${name.toLowerCase()}`;
    if (!asks.some((a) => a.key === key)) asks.push({ key, text: `"${name}" is not in Master data. Which ${what} did you mean? (Or add it in Master data first.)` });
  };
  for (const sRaw of arr(o.stops).slice(0, 12)) {
    const s = obj(sRaw);
    // a lodge alone is enough: its park follows
    const lodgeName = str(s.lodge);
    const lodge = lodgeName ? ctx.properties.find((l) => l.name.toLowerCase() === lodgeName.toLowerCase()) : undefined;
    const park = lodge ? ctx.pricing.parks.find((p) => p.id === lodge.park_id) : parkOf(s.park);
    if (!park) {
      const said = str(s.park) ?? lodgeName;
      if (said) unknownName(said, "park or lodge");
      continue;
    }
    if (lodgeName && !lodge) unknownName(lodgeName, "lodge");
    const room = ROOMS.includes(s.room as RoomWish) ? (s.room as RoomWish) : undefined;
    // a room by its own name (from a saved quote): only if that lodge has it
    const roomName = str(s.room_name) && lodge ? ctx.rooms.find((r) => r.property_id === lodge.id && r.name === str(s.room_name))?.name : undefined;
    const naturalists = int(s.naturalists, -1, 20);
    parks.push({
      name: park.name,
      lodge: lodge && lodge.park_id === park.id ? lodge.name : undefined,
      nights: int(s.nights, 1, 30),
      safaris: int(s.safaris, 0, 20),
      naturalists,
      extras: [...new Set(arr(s.extras).filter((x): x is string => typeof x === "string" && EXTRA_KEYWORDS.includes(x)))],
      room,
      ...(roomName ? { roomName } : {}),
    });
  }
  const country = str(o.country, 2);
  const flights = arr(o.flights)
    .map(obj)
    .map((f) => ({ from: str(f.from, 40), to: str(f.to, 40), time: str(f.time, 8) }))
    .filter((f): f is { from: string; to: string; time: string | undefined } => !!f.from && !!f.to && f.from !== f.to)
    .map((f) => ({ from: f.from, to: f.to, ...(f.time && /^\d{1,2}[:.]\d{2}$/.test(f.time) ? { time: f.time.replace(".", ":") } : {}) }))
    .slice(0, 6);
  const cityStays = arr(o.city_stays)
    .map(obj)
    // a city, never "another resort" / "their own hotel" (a break from our itinerary: the reader reads it)
    .filter((c) => (c.when === "before" || c.when === "after") && str(c.city) && !/\b(?:resort|hotel|lodge|camp|homestay|break|own|another|other|itinerary)\b/i.test(str(c.city) ?? "") && int(c.nights, 1, 14))
    .map((c) => ({
      when: c.when as "before" | "after",
      city: str(c.city, 40)!,
      nights: int(c.nights, 1, 14)!,
      ...(str(c.hotel) ? { hotel: str(c.hotel)! } : {}),
      ...(int(c.price, 500, 10_000_000) ? { price: int(c.price, 500, 10_000_000)! } : {}),
      ...(int(c.at, 0, 12) !== undefined ? { at: int(c.at, 0, 12)! } : {}),
    }))
    .slice(0, 6); // several cities: Delhi before; Khajuraho, then Delhi after
  const arrival = placeOf(o.arrival_place);
  const departure = placeOf(o.departure_place);
  if (str(o.arrival_place) && !arrival) unknownName(str(o.arrival_place)!, "airport, station or place");
  if (str(o.departure_place) && !departure && str(o.departure_place) !== str(o.arrival_place)) unknownName(str(o.departure_place)!, "airport, station or place");
  const meal = String(o.meal_plan ?? "").toUpperCase();
  const names = (v: unknown) => arr(v).map((x) => parkOf(x)?.name).filter((x): x is string => !!x);
  // the whole trip (3 Nov 2026): breaks from the itinerary, wishes for every stop, where it ends
  for (const b of arr(o.breaks).map(obj)) {
    const n = int(b.nights, 1, 30);
    const at = int(b.at, 0, 20);
    if (n) cityStays.push({ when: "after", city: "", nights: n, away: true, blank: true, ...(at !== undefined ? { at } : {}) } as (typeof cityStays)[number]);
  }
  const tw = obj(o.trip_wide);
  const twExtras = arr(tw.extras).filter((x): x is string => typeof x === "string" && EXTRA_KEYWORDS.includes(x));
  for (const p of parks) {
    if (tw.naturalists === -1 && p.naturalists === undefined) p.naturalists = -1;
    if (twExtras.length) p.extras = [...new Set([...(p.extras ?? []), ...twExtras])];
  }
  const endCity = str(o.end_city, 40);
  return {
    ...(o.dateless === true ? { dateless: true } : {}),
    ...(endCity ? { endCity: endCity.replace(/\s+airport.*$/i, "") } : {}),
    adults: int(o.adults, 1, 50),
    children: arr(o.children_ages).map((a) => int(a, 0, 17)).filter((a): a is number => a !== undefined).slice(0, 20),
    rooms: int(o.rooms, 1, 30),
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    nationality: country === "IN" || o.nationality === "indian" ? "indian" : country || o.nationality === "foreign" ? "foreign" : undefined,
    arrival_date: typeof o.arrival_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.arrival_date) ? o.arrival_date : undefined,
    arrival_place: arrival?.name,
    departure_place: departure?.name,
    parks,
    meal_plan: ["AP", "MAP", "CP", "EP"].includes(meal) ? (meal as ParsedTrip["meal_plan"]) : undefined,
    flights: flights.length ? flights : undefined,
    cityStays: cityStays.length ? cityStays : undefined,
    reverse: o.reverse === true || undefined,
    removeParks: names(o.remove_parks),
    order: names(o.order),
    replaceRoute: o.replace_route === true,
    // how they travel and what they ask for (checked against the message in evidence.ts)
    ...(MODES.includes(o.arrival_mode as TravelMode) ? { arrival_mode: o.arrival_mode as TravelMode } : {}),
    ...(MODES.includes(o.departure_mode as TravelMode) ? { departure_mode: o.departure_mode as TravelMode } : {}),
    ...(o.between === "own" || o.between === "ours" ? { between: o.between } : {}),
    ...(o.own_all === true ? { own_all: true } : {}),
    ...(requestsOf(o.requests).length ? { requests: requestsOf(o.requests) } : {}),
    ...(asks.length ? { asks } : {}),
    notes: [],
  };
}

// ---------------------------------------------------------------- learning from past quotes
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
export function similarExamples(all: Example[], message: string, k = 3): Example[] {
  const m = words(message);
  return all
    .map((e) => {
      const w = words(e.message);
      const inter = [...w].filter((x) => m.has(x)).length;
      return { e, score: inter / Math.max(1, new Set([...w, ...m]).size) };
    })
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.e);
}

// A quote the team saved, written as the JSON the AI should have answered.
export function planToExample(plan: Plan, ctx: BuilderContext): string {
  const park = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? null;
  const lodge = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? null;
  const loc = (id: string | null) => (id ? ctx.locations.find((l) => l.id === id)?.name ?? null : null);
  const stops = plan.stops.map((s) => {
    const days = plan.days.filter((d) => d.park_id === s.park_id).slice(0, s.nights + 1);
    const saf = days.flatMap((d) => d.safaris);
    const room = roomLabel(s, ctx);
    return {
      park: park(s.park_id),
      lodge: lodge(s.property_id),
      nights: s.nights,
      room: /tree ?house/i.test(room) ? "tree" : /suite/i.test(room) ? "suite" : /deluxe room/i.test(room) ? "deluxe" : null,
      safaris: s.want_safaris ?? saf.length,
      naturalists: s.want_naturalists ?? saf.filter((x) => x.naturalist).length,
      extras: s.want_extras ?? [],
    };
  });
  return JSON.stringify({
    replace_route: true,
    adults: plan.guest.adults,
    children_ages: plan.guest.children,
    rooms: plan.guest.rooms,
    country: plan.guest.country || null,
    arrival_date: plan.arrival_date,
    arrival_place: loc(plan.arrival_location_id),
    departure_place: loc(plan.departure_location_id),
    stops,
    flights: plan.flights ?? [],
    city_stays: (plan.city_stays ?? []).map((c) => ({ when: c.when, city: c.city, nights: c.nights })),
  });
}
