// =====================================================================
// The travel rule book (owner, 5 Nov 2026). One place for how a trip moves, used by the reader
// (parse-text / route.ts), the planner, the Confirm step and the hard checks. Everything is read
// from Master data (places, roads, flight routes, settings); nothing here names one city's case.
//
// 1. A lodge's airport: the airport with a transfer rate to the lodge in Master data, the shortest
//    drive first (Denwa > Bhopal, Waghoba > Nagpur, Ken River > Khajuraho). Two that are both used
//    (Iora Retreat: Jorhat or Guwahati) are asked once when the enquiry does not say.
// 2. Two places in different road regions (no road joins them in Master data) are joined by a
//    flight: lodge > its airport, the flight, the arrival airport > the next lodge or hotel.
//    Never a road between regions.
// 3. City nights have their own city's airport transfers: airport > hotel on arrival, hotel >
//    airport on leaving. Never a hotel in one city and an airport of another city (the airport
//    must be named after the city, or have a road to the hotel in Master data: Bagdogra for Siliguri).
// 4. Every domestic flight in the circuit: Rs 15,000 per person one way (Master data > Flight
//    routes; Sales settings "Domestic flight fare" when a route has no row). Never "price needed".
// 5. Guest words: "1 double" / "1 twin" = 2 adults, 1 room; "2 doubles" = 4 adults, 2 rooms;
//    "1 triple" = 3 adults, 1 room; "single" = 1 adult, 1 room; "couple" / "honeymoon" = 2 adults;
//    "family of 4" = 4 guests (the adult / child split is asked).
// =====================================================================

import { airportServes, roadRegions, segments, type Segment } from "./planner";
import { sameCity } from "./cities";
import { DRIVE_CITIES } from "@/lib/sales/master/missing-transfers";
import type { BuilderContext, Plan, PlanFlight } from "./types";

// Rule 4: the fare when Master data > Flight routes has no row for the leg (Sales settings can change it).
export { DOMESTIC_FLIGHT_FARE, flightFare } from "./flight-fare";

// The airports of the circuit (as Master data > Flight routes names their cities).
export const CIRCUIT_AIRPORT_CITIES = ["Delhi", "Bhopal", "Jabalpur", "Nagpur", "Khajuraho", "Raipur", "Guwahati", "Jorhat", "Bagdogra"] as const;
// Their road regions in Master data (5 Nov 2026): Central India (the seven lodges), Kaziranga, Siliguri, Delhi.
const CENTRAL = ["Bhopal", "Jabalpur", "Nagpur", "Khajuraho", "Raipur"];
const NORTH_EAST = ["Guwahati", "Jorhat"];
// Every flight the rule book can plan, both ways: Delhi to and from every airport, and every pair of
// airports in different regions. supabase/sales_itinerary_rules_2026-11-05.sql adds the ones missing.
export const CIRCUIT_FLIGHTS: [string, string][] = (() => {
  const pairs: [string, string][] = [];
  const both = (a: string, b: string) => pairs.push([a, b], [b, a]);
  for (const c of CIRCUIT_AIRPORT_CITIES) if (c !== "Delhi") both("Delhi", c);
  for (const a of CENTRAL) for (const b of [...NORTH_EAST, "Bagdogra"]) both(a, b);
  for (const a of NORTH_EAST) both(a, "Bagdogra");
  return pairs;
})();

// ---------------------------------------------------------------- places, from Master data

const isAirport = (t: string) => t === "airport";
export const airportCityName = (name: string) =>
  name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(international|domestic|airport)\b/gi, "").replace(/\s+/g, " ").trim();
const locOfProperty = (ctx: BuilderContext, id: string) => ctx.locations.find((l) => l.property_id === id)?.id ?? null;
const activeRates = (ctx: BuilderContext) => ctx.pricing.transferRates.filter((r) => r.active !== false);
const linked = (ctx: BuilderContext, a: string, b: string) =>
  activeRates(ctx).some((r) => (r.from_location_id === a && r.to_location_id === b) || (r.from_location_id === b && r.to_location_id === a));

// Rule 1: the airports with a road to a lodge, the shortest drive first
export function lodgeAirports(ctx: BuilderContext, propertyId: string): { id: string; name: string; city: string; hours: number }[] {
  const loc = locOfProperty(ctx, propertyId);
  if (!loc) return [];
  const out: { id: string; name: string; city: string; hours: number }[] = [];
  for (const l of ctx.locations.filter((x) => isAirport(x.type))) {
    const r = activeRates(ctx).find((t) => (t.from_location_id === l.id && t.to_location_id === loc) || (t.to_location_id === l.id && t.from_location_id === loc));
    if (r && !out.some((o) => o.id === l.id)) out.push({ id: l.id, name: l.name, city: airportCityName(l.name), hours: r.drive_hours ?? 99 });
  }
  return out.sort((x, y) => x.hours - y.hours || x.name.localeCompare(y.name));
}

// The hotel place of a city stay: the hotel named, else the city's hotel in Master data
function cityHotelLoc(ctx: BuilderContext, city: string, hotel?: string): string | null {
  const byName = hotel ? ctx.properties.find((p) => p.name.toLowerCase() === hotel.trim().toLowerCase()) : undefined;
  const p = byName ?? ctx.properties.find((x) => x.kind === "city_hotel" && !!x.city && sameCity(x.city, city));
  return p ? locOfProperty(ctx, p.id) : null;
}

// Rule 3: the airport of a city: the one named after it (Delhi Airport (IGI)), else the one with a road
// to its hotel (Bagdogra for Siliguri). `city` is the name Flight routes use ("Bagdogra").
export function cityAirport(ctx: BuilderContext, city: string, hotel?: string): { id: string; name: string; city: string } | null {
  const named = ctx.locations.filter((l) => isAirport(l.type) && sameCity(l.name, city));
  const h = cityHotelLoc(ctx, city, hotel);
  const pick =
    (h ? named.find((l) => linked(ctx, l.id, h)) : undefined) ??
    named.find((l) => /airport/i.test(l.name)) ??
    named[0] ??
    (h ? ctx.locations.find((l) => isAirport(l.type) && linked(ctx, l.id, h)) : undefined);
  return pick ? { id: pick.id, name: pick.name, city: airportCityName(pick.name) } : null;
}

// A city with an airport in Master data (a flight can leave from it)
export const hasAirport = (ctx: BuilderContext, city: string) => ctx.locations.some((l) => isAirport(l.type) && sameCity(l.name, city));

// ---------------------------------------------------------------- regions

// The road region of a stay: a lodge's place; a city's hotel, else its airport; a city with neither
// (Agra and Jaipur hotels have no roads yet) takes the region of its road-trip partner (Delhi).
export function stayRegion(ctx: BuilderContext, seg: Segment, regions = roadRegions(ctx)): string | null {
  if (seg.kind === "lodge") return regions.get(locOfProperty(ctx, seg.stop.property_id) ?? "") ?? null;
  const c = seg.stay;
  if (!c.city || c.away || c.blank) return null;
  const own = (city: string, hotel?: string) => regions.get(cityHotelLoc(ctx, city, hotel) ?? "") ?? regions.get(cityAirport(ctx, city, hotel)?.id ?? "") ?? null;
  const r = own(c.city, c.hotel);
  if (r) return r;
  for (const [a, b] of DRIVE_CITIES) {
    const partner = sameCity(a, c.city) ? b : sameCity(b, c.city) ? a : null;
    const pr = partner ? own(partner) : null;
    if (pr) return pr;
  }
  return null;
}

// Rule 1: at our own lodges the shortest drive wins, without a question (Pench: Nagpur 3 h, not Jabalpur
// 4 h; Satpura: Bhopal). Asked once: a partner lodge with more than one airport (Iora Retreat: Jorhat or
// Guwahati, owner 5 Nov 2026), or any lodge where Master data cannot tell which is nearer (no drive
// hours, or the same hours).
export const airportUnclear = (o: { hours: number }[], kind?: string | null) =>
  o.length > 1 && ((!!kind && kind !== "own_lodge") || o[0].hours >= 99 || o[1].hours >= 99 || o[0].hours === o[1].hours);
function twoAirports(ctx: BuilderContext, propertyId: string): string[] {
  const o = lodgeAirports(ctx, propertyId);
  if (!airportUnclear(o, ctx.properties.find((p) => p.id === propertyId)?.kind)) return [];
  return [...new Set(o.map((x) => x.city))];
}

// Does the trip start / end with nights in a city (not a lodge)? Then its way in / out is that
// city's airport (rule 3): no arrival or departure point to ask.
export function cityEnds(plan: Plan): { startsInCity: boolean; endsInCity: boolean } {
  const segs = segments(plan).filter((s) => s.kind === "lodge" || (!!s.stay.city && !s.stay.away && !s.stay.blank));
  return { startsInCity: segs[0]?.kind === "city", endsInCity: segs[segs.length - 1]?.kind === "city" };
}

// ---------------------------------------------------------------- the pass

export interface RuleResult {
  plan: Plan;
  notes: string[]; // what the rules did, said in the chat
  airportsChosen: { park_id: string; options: string[]; chosen: string }[]; // taken without being said: asked once
}

/**
 * The rule book applied to a trip, whoever made it (the reader, the AI, the form). Pure.
 * - two stays in a row that no road joins are joined by a flight (rules 1, 2, 3);
 * - flights are between airports: a city's flight leaves from its airport's city (Siliguri: Bagdogra);
 *   a first flight from a home city not in Master data ("from Mumbai") is the guests' own;
 * - a trip that starts / ends at a lodge: the lodge's nearest airport, unless they come by train or
 *   their own vehicle, or a place is already set;
 * - the drive at the end (end_city) only from a city that drives there (a road-trip pair or a road).
 * `saidAirports`: airports written in the enquiry ("fly to jorhat"): not asked again.
 */
export function applyTravelRules(plan: Plan, ctx: BuilderContext, opts: { saidAirports?: string[] } = {}): RuleResult {
  const notes: string[] = [];
  const asked: RuleResult["airportsChosen"] = [];
  if (!plan.stops.length) return { plan, notes, airportsChosen: asked };
  const regions = roadRegions(ctx);
  const segs = segments(plan).filter((s) => s.kind === "lodge" || (!!s.stay.city && !s.stay.away && !s.stay.blank));
  const lodgeName = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? "the lodge";
  const said = (opts.saidAirports ?? []).map((s) => s.toLowerCase());
  // a stay in this city (a touring stay "Delhi - Agra - Jaipur" is in each of its cities)
  const stayCity = (city: string) =>
    segs.find((s): s is Extract<Segment, { kind: "city" }> => s.kind === "city" && s.stay.city.split(/\s+-\s+/).some((part) => sameCity(part, city)));

  // ---- flights are between airports
  let flights: PlanFlight[] = (plan.flights ?? []).map((f) => {
    const fix = (city: string) => {
      if (hasAirport(ctx, city)) return city;
      const st = stayCity(city);
      if (!st) return city;
      // a touring stay ("Delhi - Agra - Jaipur"): that city's own airport, never another of the tour's
      const touring = /\s-\s/.test(st.stay.city);
      return cityAirport(ctx, touring ? city : st.stay.city, touring ? undefined : st.stay.hotel)?.city || city;
    };
    return { ...f, from: fix(f.from), to: fix(f.to) };
  });
  let next: Plan = plan;
  // a flight from (to) a city with no airport in Master data and no stay there ("from Mumbai ... fly to
  // Jorhat"): the guests' own, from home, not ours to plan or price. A first one tells where they land;
  // one in the middle of the trip is left to rule 2 (the flight from the last stay's airport)
  const offCircuit = (c: string) => !hasAirport(ctx, c) && !stayCity(c);
  flights.forEach((own, i) => {
    if (!offCircuit(own.from) && !offCircuit(own.to)) return;
    notes.push(`The flight ${own.from} to ${own.to} is not in our circuit (no airport in Master data): ${i === 0 && !offCircuit(own.to) ? `the trip starts at ${own.to}` : "left out"}.`);
    if (i === 0 && !offCircuit(own.to) && !next.arrival_location_id && segs[0]?.kind === "lodge") {
      const ap = lodgeAirports(ctx, segs[0].stop.property_id).find((a) => sameCity(a.city, own.to));
      if (ap) next = { ...next, arrival_location_id: ap.id };
    }
  });
  flights = flights.filter((f) => !offCircuit(f.from) && !offCircuit(f.to));

  // ---- a lodge's airport: one its flights already use, else one written, else the nearest
  const lodgeSide = (seg: Extract<Segment, { kind: "lodge" }>): string | null => {
    const options = lodgeAirports(ctx, seg.stop.property_id);
    if (!options.length) return null;
    const flown = options.find((o) => flights.some((f) => sameCity(f.from, o.city) || sameCity(f.to, o.city)) || o.id === next.arrival_location_id || o.id === next.departure_location_id);
    if (flown) return flown.city;
    // written as a way in or out ("fly to jorhat", "arriving guwahati", "via nagpur"), not any mention
    // of the town (Khajuraho nights are not Kings Lodge's airport)
    const travelWord = (city: string) => new RegExp(`\\b(?:fly\\w*|flight\\w*|arriv\\w*|land\\w*|via|depart\\w*|leav\\w*|out of|in to|into)\\s+(?:to\\s+|at\\s+|in\\s+|from\\s+|via\\s+)?${city.toLowerCase()}\\b`);
    const written = options.find((o) => said.some((s) => travelWord(o.city).test(s)));
    if (written) return written.city;
    const two = twoAirports(ctx, seg.stop.property_id);
    if (two.length && !asked.some((c) => c.park_id === seg.stop.park_id)) asked.push({ park_id: seg.stop.park_id, options: two, chosen: options[0].city });
    return options[0].city;
  };
  const side = (seg: Segment): string | null => (seg.kind === "lodge" ? lodgeSide(seg) : cityAirport(ctx, seg.stay.city, seg.stay.hotel)?.city ?? null);
  const airportRegion = (city: string): string | null => {
    const st = stayCity(city);
    const ap = st
      ? cityAirport(ctx, st.stay.city, st.stay.hotel)
      : ctx.locations.find((l) => isAirport(l.type) && sameCity(l.name, city) && regions.has(l.id)) ?? ctx.locations.find((l) => isAirport(l.type) && sameCity(l.name, city));
    return ap ? regions.get(ap.id) ?? null : null;
  };
  const drivePair = (a: string, b: string) => DRIVE_CITIES.some(([x, y]) => (sameCity(x, a) && sameCity(y, b)) || (sameCity(y, a) && sameCity(x, b)));

  // ---- two stays in a row in different regions: the flight between them (rule 2). Each such leg has
  // its own flight, in trip order (Delhi, Tree House, Delhi, Kings Lodge: Delhi > Jabalpur twice)
  const added: PlanFlight[] = [];
  const used = new Set<PlanFlight>();
  let lastUsed = -1; // the leg's flight comes after the one the leg before used
  for (let k = 1; k < segs.length; k++) {
    const a = segs[k - 1];
    const b = segs[k];
    const ra = stayRegion(ctx, a, regions);
    const rb = stayRegion(ctx, b, regions);
    if (ra && rb && ra === rb) {
      // one region: a road; a flight written for this leg (Tadoba, then "fly nagpur to khajuraho") is kept
      const sides = (s: Segment) => (s.kind === "lodge" ? lodgeAirports(ctx, s.stop.property_id).map((o) => o.city) : [s.stay.city, cityAirport(ctx, s.stay.city, s.stay.hotel)?.city ?? ""]);
      const written = flights.find((f) => !used.has(f) && sides(a).some((c) => c && sameCity(c, f.from)) && sides(b).some((c) => c && sameCity(c, f.to)));
      if (written) {
        used.add(written);
        lastUsed = Math.max(lastUsed, flights.indexOf(written));
      }
      continue;
    }
    if (!ra || !rb) continue;
    const mine = flights.find((f) => !used.has(f) && airportRegion(f.from) === ra && (airportRegion(f.to) === rb || (a.kind === "city" && b.kind === "city" && drivePair(f.to, b.stay.city))));
    if (mine) {
      // a written / earlier flight for this leg (or a connecting flight out of a city, then the drive:
      // Khajuraho > Delhi, then by road to Agra). Its ends are the lodges' own airports: "denwa, then fly
      // to guwahati" read as Khajuraho > Guwahati leaves from Bhopal (an airport with a road to Denwa)
      const reaches = (seg: Segment, city: string) => seg.kind !== "lodge" || lodgeAirports(ctx, seg.stop.property_id).some((o) => sameCity(o.city, city));
      const i = flights.indexOf(mine);
      const fixed = { ...mine, from: reaches(a, mine.from) ? mine.from : side(a) ?? mine.from, to: reaches(b, mine.to) ? mine.to : side(b) ?? mine.to };
      flights[i] = fixed;
      used.add(fixed);
      lastUsed = Math.max(lastUsed, i);
      continue;
    }
    const from = side(a);
    const to = side(b);
    if (!from || !to || sameCity(from, to)) continue;
    const f = { from, to };
    flights.splice(lastUsed + 1, 0, f);
    used.add(f);
    lastUsed = flights.indexOf(f);
    added.push(f);
  }
  if (added.length) notes.push(`No road between ${added.length === 1 ? "two of the places" : "some of the places"} in Master data, so by air: ${added.map((f) => `${f.from} to ${f.to}`).join(", ")}.`);
  // a flight that is no leg of the trip (read twice, or between places the trip does not join) is left
  // out, except the one that brings the guests to the first stay and the one that takes them home
  // Only when Master data knows every stay's region and both ends of the flight (else nothing is left out).
  const firstRegion = segs[0] ? stayRegion(ctx, segs[0], regions) : null;
  const lastRegion = segs.length ? stayRegion(ctx, segs[segs.length - 1], regions) : null;
  const allKnown = segs.every((s) => !!stayRegion(ctx, s, regions));
  const firstCity = segs[0]?.kind === "city" ? segs[0].stay.city : null;
  const lastCity = segs[segs.length - 1]?.kind === "city" ? (segs[segs.length - 1] as Extract<Segment, { kind: "city" }>).stay.city : null;
  const stray = flights.filter((f, i) => {
    if (used.has(f) || !allKnown || !airportRegion(f.from) || !airportRegion(f.to)) return false;
    // the way in from outside the trip (or from the city they end in) and the way home (or back to the
    // city they began in: Delhi, ..., Kaziranga, Jorhat > Delhi)
    // (wherever it is in the list: no leg's flight before the way in, none after the way home)
    const inbound = airportRegion(f.to) === firstRegion && (!stayCity(f.from) || (!!lastCity && sameCity(f.from, lastCity))) && ![...used].some((u) => flights.indexOf(u) < i);
    const outbound = airportRegion(f.from) === lastRegion && (!stayCity(f.to) || (!!firstCity && sameCity(f.to, firstCity))) && ![...used].some((u) => flights.indexOf(u) > i);
    return !inbound && !outbound;
  });
  if (stray.length) {
    flights = flights.filter((f) => !stray.includes(f));
    notes.push(`Left out ${stray.map((f) => `${f.from} to ${f.to}`).join(", ")}: no leg of the trip.`);
  }
  next = { ...next, flights };

  // ---- the first lodge after city nights / the last lodge before city nights (rule 3): the way in /
  // out is from that city, never a guess from another flight: the same region = by road (the planner
  // drives from / to the hotel), else the lodge's airport for the flight
  const firstLodgeAt = segs.findIndex((s) => s.kind === "lodge");
  const lastLodgeAt = segs.length - 1 - [...segs].reverse().findIndex((s) => s.kind === "lodge");
  // (only what Master data can tell: unknown regions, a city with no hotel place or no flight found
  // leave the trip's own points as they are)
  const lodgeEnd = (k: number, out: boolean): string | null | undefined => {
    const lodge = segs[k] as Extract<Segment, { kind: "lodge" }>;
    const city = segs[out ? k + 1 : k - 1];
    if (!city || city.kind !== "city") return undefined; // not after / before city nights: unchanged
    const rc = stayRegion(ctx, city, regions);
    const rl = stayRegion(ctx, lodge, regions);
    if (!rc || !rl) return undefined;
    if (rc === rl) return cityHotelLoc(ctx, city.stay.city, city.stay.hotel) ? null : undefined;
    const options = lodgeAirports(ctx, lodge.stop.property_id);
    const f = flights.find((x) => options.some((o) => sameCity(out ? x.from : x.to, o.city)));
    return (f && options.find((o) => sameCity(out ? f.from : f.to, o.city))?.id) ?? undefined;
  };
  if (firstLodgeAt > 0) {
    const a = lodgeEnd(firstLodgeAt, false);
    if (a !== undefined && a !== next.arrival_location_id) next = { ...next, arrival_location_id: a };
  }
  if (lastLodgeAt >= 0 && lastLodgeAt < segs.length - 1) {
    const d = lodgeEnd(lastLodgeAt, true);
    if (d !== undefined && d !== next.departure_location_id) next = { ...next, departure_location_id: d };
  }

  // ---- the way in and out of a trip that starts or ends at a lodge (rule 1)
  const first = segs[0];
  const last = segs[segs.length - 1];
  const byRoad = (m: Plan["arrival_mode"]) => m === "own" || m === "train" || m === "transfer";
  if (!next.own_vehicle && first?.kind === "lodge" && !next.arrival_location_id && !byRoad(next.arrival_mode)) {
    const city = lodgeSide(first);
    const ap = lodgeAirports(ctx, first.stop.property_id).find((o) => o.city === city);
    if (ap) {
      next = { ...next, arrival_location_id: ap.id };
      notes.push(`Arriving at ${ap.name}, the nearest airport to ${lodgeName(first.stop.property_id)}.`);
    }
  }
  if (!next.own_vehicle && last?.kind === "lodge" && !next.departure_location_id && !byRoad(next.departure_mode)) {
    const options = lodgeAirports(ctx, last.stop.property_id);
    const city = lodgeSide(last);
    const ap = options.find((o) => o.id === next.arrival_location_id) ?? options.find((o) => o.city === city);
    if (ap) {
      next = { ...next, departure_location_id: ap.id };
      notes.push(`Leaving from ${ap.name}, the nearest airport to ${lodgeName(last.stop.property_id)}.`);
    }
  }

  // ---- "back to Delhi for the flight home" after the last LODGE (Tadoba, then Delhi): the lodge's airport
  // and the flight to that city when no road joins them (Example 3: Waghoba > Nagpur Airport, Nagpur >
  // Delhi); in the same region, the drive to that city's airport
  if (next.end_city && last?.kind === "lodge" && !next.own_vehicle) {
    const port = cityAirport(ctx, next.end_city);
    const rl = stayRegion(ctx, last, regions);
    const rp = port ? regions.get(port.id) ?? null : null;
    if (port && rl && rp && rl !== rp) {
      const from = lodgeSide(last);
      const ap = lodgeAirports(ctx, last.stop.property_id).find((o) => o.city === from);
      if (from && !flights.some((f) => sameCity(f.from, from) && sameCity(f.to, port.city))) flights = [...flights, { from, to: port.city }];
      next = { ...next, flights, end_city: null, ...(ap ? { departure_location_id: ap.id } : {}) };
      notes.push(`Back to ${next.end_city ?? port.city}: the flight ${from} to ${port.city}.`);
    } else if (port && rl && rp && rl === rp) next = { ...next, end_city: null, departure_location_id: port.id };
  }

  // ---- the drive at the end (rule 3): only from a city that drives there
  if (next.end_city) {
    const lastCity = last?.kind === "city" ? last.stay : null;
    const hotel = lastCity ? cityHotelLoc(ctx, lastCity.city, lastCity.hotel) : null;
    const port = cityAirport(ctx, next.end_city);
    const road = !!hotel && !!port && linked(ctx, hotel, port.id);
    if (!lastCity || sameCity(lastCity.city, next.end_city) || (!drivePair(lastCity.city, next.end_city) && !road)) next = { ...next, end_city: null };
  }
  return { plan: next, notes, airportsChosen: asked };
}

// ---------------------------------------------------------------- rule 5: guest words

export interface GuestWords {
  adults?: number;
  rooms?: number;
  family?: number; // "family of 4": the guests in all (the adult / child split is asked)
  quote: string; // the words, as written
}
const ROOM_ADULTS: Record<string, number> = { double: 2, twin: 2, triple: 3, single: 1 };
const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ek: 1, do: 2, teen: 3, char: 4 };
const toN = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_N[s]);

/** "1 double", "2 doubles", "1 triple + 1 double", "single", "couple", "honeymoon", "family of 4". */
export function guestWords(text: string): GuestWords | null {
  const low = ` ${text.toLowerCase()} `;
  const counted = /\b\d+\s*(adults?|adlts?|pax|people|persons|guests)\b/.test(low);
  // rooms by kind: "1 double", "2 doubles", "one twin room", "a triple" (not "double bed", "single supplement")
  const re = /\b(\d+|a|an|one|two|three|four|five|six|ek|do|teen|char)\s+(double|twin|triple|single)s?\b(?!\s*(?:bed|occupancy|supplement|sharing))/g;
  let adults = 0;
  let rooms = 0;
  const quotes: string[] = [];
  for (let m = re.exec(low); m; m = re.exec(low)) {
    const n = toN(m[1]);
    if (!n || n > 20) continue;
    adults += n * ROOM_ADULTS[m[2]];
    rooms += n;
    quotes.push(m[0].trim());
  }
  if (rooms) return { ...(counted ? {} : { adults }), rooms, quote: quotes.join(" + ") };
  const fam = low.match(/\bfamily of (\d+|three|four|five|six)\b/);
  if (fam) return { family: toN(fam[1]), quote: fam[0] };
  if (counted) return null;
  const solo = low.match(/\b(single traveller|single traveler|solo traveller|solo traveler|solo|single)\b(?!\s*(?:room|bed|occupancy|supplement))/);
  if (solo) return { adults: 1, rooms: 1, quote: solo[0] };
  const two = low.match(/\b(couple|honey\s?moon(?:ers?|ing)?)\b/);
  if (two) return { adults: 2, quote: two[0] };
  return null;
}
