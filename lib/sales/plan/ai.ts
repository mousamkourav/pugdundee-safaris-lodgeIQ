// =====================================================================
// The AI side of the trip assistant (pure functions, no network here).
//   buildPrompt  - what Gemini is told: your parks, lodges, rooms, places,
//                  experiences, glossary, similar past enquiries, the trip so far
//   aiToParsed   - Gemini's JSON turned into a ParsedTrip, keeping only names
//                  that exist in master data and numbers in sensible ranges
//   (merging with the built-in reader: reading.ts, fillGaps - the AI fills gaps only)
//   similarExamples / planToExample - "learning" from quotes already made
// =====================================================================

import { EXTRA_WORDS, aliasesOf, locationAliases, matchByName, scrubForAI, type Ask, type ParsedTrip, type RoomWish } from "./parse-text";
import type { BuilderContext, Plan } from "./types";
import { cityHotels, safariOnly } from "./cities";

export const EXTRA_KEYWORDS = [...new Set(EXTRA_WORDS.map(([, k]) => k)), "special"];
const ROOMS: RoomWish[] = ["cottage", "tree", "suite", "deluxe"];

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
      return `${l.name}${rooms.length ? ` (rooms: ${rooms.join(", ")})` : ""}`;
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
  examples: Example[];
  today: string;
}): string {
  const { ctx } = input;
  return [
    "You help a safari company's sales team turn a guest enquiry into a trip. Read the LAST MESSAGE (in the light of the conversation and the trip so far) and answer with JSON only.",
    "The team writes quickly, often in broken English, with spelling mistakes, Hindi or Hinglish words (raat = night, din = day, log / pax / bande = people, bacche = children, phir / fir = then, wapas = back). Understand the meaning.",
    `Today is ${input.today}. Dates are YYYY-MM-DD; a date without a year is the next one in the future.`,
    "",
    catalogText(ctx),
    `EXPERIENCE KEYWORDS (use only these): ${EXTRA_KEYWORDS.join(", ")}. "special" means the lodge's own special experiences.`,
    input.glossary.length ? `TEAM GLOSSARY:\n${input.glossary.map((g) => `- ${g.term} = ${g.meaning}`).join("\n")}` : "",
    "",
    "RULES:",
    "- Copy park, lodge, room and place names EXACTLY from the lists. Never invent one; use null if unsure.",
    '- "lodge": only when the message names the lodge; otherwise null. Never choose a lodge yourself, even where a park has only one or two lodges.',
    '- "3 days" at a lodge means 3 nights. A second lodge in the same park is a separate stop.',
    '- arrival_place is where the road transfer to the first lodge starts (after any flight). departure_place is where the guests leave from at the end (before any flight).',
    "- Cities like Delhi are not stops: nights there go in city_stays (before or after the safari, in travel order; there can be several, e.g. Khajuraho then Delhi at the end), flights in flights.",
    "- safaris = jeep safaris wanted at that stop; naturalists = how many of them with a naturalist (-1 = all). A boat safari is an experience, not a jeep safari.",
    '- room: "cottage", "tree" (tree house), "suite" (forest suite) or "deluxe" (deluxe room), only when said.',
    '- For a change to the trip so far ("make Pench 2 nights", "add Kanha"), give only what changes and set replace_route false. For a whole new route set replace_route true.',
    '- "wrong direction" / "reverse" -> reverse true. A new order -> order (park names in the new order). Taking a park out -> remove_parks.',
    "- Use null or empty arrays for anything not said. Do not guess.",
    "",
    'JSON keys: {"replace_route": bool, "adults": n, "children_ages": [n], "rooms": n, "country": "ISO2", "nationality": "indian"|"foreign", "arrival_date": "YYYY-MM-DD", "arrival_place": name, "departure_place": name,',
    ' "stops": [{"park": name, "lodge": name, "nights": n, "room": "cottage"|"tree"|"suite"|"deluxe", "safaris": n, "naturalists": n, "extras": [keyword]}],',
    ' "remove_parks": [name], "order": [name], "reverse": bool, "flights": [{"from": city, "to": city, "time": "HH:MM"}],',
    ' "city_stays": [{"when": "before"|"after", "city": city, "nights": n, "hotel": name, "price": n}], "meal_plan": "AP"|"MAP"|"CP"|"EP"}',
    "",
    input.examples.length ? `EXAMPLES OF ENQUIRIES THIS TEAM HAS QUOTED (message -> correct JSON):\n${input.examples.map((e) => `Message: ${e.message}\nJSON: ${e.expected}`).join("\n\n")}` : "",
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
    .filter((c) => (c.when === "before" || c.when === "after") && str(c.city) && int(c.nights, 1, 14))
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
  return {
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
    const room = ctx.rooms.find((r) => r.id === s.room_category_id)?.name ?? "";
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
