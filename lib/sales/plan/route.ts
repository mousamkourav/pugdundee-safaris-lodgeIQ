// The route of a trip, from the places in the order they are written (city nights and
// lodges) and the roads in Master data.
//
// One rule, whatever the wording: two places one after the other that no road joins
// (they are in different road regions, see roadRegions) are joined by a flight. So
// "Delhi one night, than Kaziranga 2 nights, than come back to Delhi" has a flight
// Delhi > (Kaziranga's airport) and one back, without the word "flight"; and a drive
// is never planned between Delhi and Iora Retreat, or Waghoba and Iora Retreat.
//
// The airport for a lodge is the one named in the text near that leg ("go to Bhopal than
// Satpura", "delhi from nagpur"), else the airport with a road to the lodge in Master data
// (the shortest drive; when there are several, e.g. Guwahati and Jorhat for Iora Retreat,
// the sales person is asked once).
import type { BuilderContext } from "./types";
import { roadRegions } from "./planner";
import { sameCity } from "./cities";
import { DRIVE_CITIES } from "@/lib/sales/master/missing-transfers";
import { airportUnclear } from "./travel-rules";

export type RouteEntry =
  | { kind: "city"; city: string; pos: number }
  | { kind: "lodge"; park: string; propertyId: string | null; pos: number };

export interface RouteFlight {
  from: string;
  to: string;
  time?: string;
}

export interface RouteResult {
  flights: RouteFlight[];
  arrival?: string | null; // airport name for the first lodge (null: none could be found)
  departure?: string | null; // airport name for the last lodge
  asks: { key: string; text: string; quick: string[] }[];
}

const isAirport = (t: string) => t === "airport";

export function resolveRoute(input: {
  ctx: BuilderContext;
  entries: RouteEntry[];
  cityMentions: { at: number; city: string }[];
  flights: (RouteFlight & { pos: number })[];
}): RouteResult {
  const { ctx, entries, cityMentions } = input;
  const regions = roadRegions(ctx);
  const rates = ctx.pricing.transferRates.filter((r) => r.active !== false);
  const locOfProperty = (id: string | null) => (id ? ctx.locations.find((l) => l.property_id === id)?.id ?? null : null);
  const airportsOfCity = (city: string) => ctx.locations.filter((l) => isAirport(l.type) && sameCity(l.name, city));
  const cityOfAirport = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(international|domestic|airport)\b/gi, "").replace(/\s+/g, " ").trim();
  // the regions a city's places belong to (Khajuraho Airport is in Ken River Lodge's region)
  const cityRegions = (city: string) =>
    new Set(ctx.locations.filter((l) => l.type !== "property" && sameCity(l.name, city)).map((l) => regions.get(l.id)).filter((r): r is string => !!r));
  const regionOf = (e: RouteEntry) => (e.kind === "lodge" ? regions.get(locOfProperty(e.propertyId) ?? "") : undefined);

  // a road joins A and B (or Master data cannot tell: then nothing is invented)
  const joined = (a: RouteEntry, b: RouteEntry): boolean => {
    if (a.kind === "city" && b.kind === "city") {
      // Delhi > Agra: a drive unless a flight is written. Two cities Master data shows are apart
      // (their places have roads, none to each other's region: Khajuraho > Delhi) are a flight (3 Nov 2026)
      if (DRIVE_CITIES.some(([x, y]) => (sameCity(x, a.city) && sameCity(y, b.city)) || (sameCity(y, a.city) && sameCity(x, b.city)))) return true;
      const ra = cityRegions(a.city);
      const rb = cityRegions(b.city);
      return !ra.size || !rb.size || [...ra].some((r) => rb.has(r));
    }
    if (a.kind === "lodge" && b.kind === "lodge") {
      const ra = regionOf(a);
      const rb = regionOf(b);
      return !ra || !rb || ra === rb;
    }
    const lodge = (a.kind === "lodge" ? a : b) as Extract<RouteEntry, { kind: "lodge" }>;
    const city = (a.kind === "city" ? a : b) as Extract<RouteEntry, { kind: "city" }>;
    const r = regionOf(lodge);
    const cr = cityRegions(city.city);
    // Master data must show the city is elsewhere (its places have roads, none to this lodge's
    // region); a city with no roads at all in Master data is not guessed
    if (!r || !cr.size) return true;
    return cr.has(r);
  };

  // airports with a road to a lodge, the shortest drive first
  const airportsOfLodge = (e: Extract<RouteEntry, { kind: "lodge" }>) => {
    const loc = locOfProperty(e.propertyId);
    if (!loc) return [] as { name: string; hours: number }[];
    const out: { name: string; hours: number }[] = [];
    for (const l of ctx.locations.filter((x) => isAirport(x.type))) {
      const r = rates.find((t) => (t.from_location_id === l.id && t.to_location_id === loc) || (t.to_location_id === l.id && t.from_location_id === loc));
      if (r && !out.some((o) => o.name === l.name)) out.push({ name: l.name, hours: r.drive_hours ?? 99 });
    }
    return out.sort((x, y) => x.hours - y.hours);
  };
  // is this city on the lodge's side of a leg (its airport is in the lodge's region)?
  const cityNearLodge = (city: string, e: Extract<RouteEntry, { kind: "lodge" }>) => {
    const r = regionOf(e);
    return !!r && airportsOfCity(city).some((l) => regions.get(l.id) === r);
  };

  const asks: RouteResult["asks"] = [];
  const chosen = new Map<string, string>(); // park -> city of its airport, once per park
  const lodgeCity = (e: Extract<RouteEntry, { kind: "lodge" }>, window: { at: number; city: string }[], written: RouteFlight[]): string | null => {
    // named in the text for this leg ("go to bhopal than satpura", "delhi from nagpur")
    const named = window.find((m) => cityNearLodge(m.city, e)) ?? null;
    if (named) {
      chosen.set(e.park, named.city);
      return named.city;
    }
    // a written flight into or out of the lodge's region
    const flown = written.flatMap((f) => [f.from, f.to]).find((c) => cityNearLodge(c, e));
    if (flown) {
      chosen.set(e.park, flown);
      return flown;
    }
    if (chosen.has(e.park)) return chosen.get(e.park)!;
    const options = airportsOfLodge(e);
    if (!options.length) return null;
    const city = cityOfAirport(options[0].name);
    chosen.set(e.park, city);
    // rule 1 (travel-rules.ts): the shortest drive in Master data, not asked; asked only when Master data
    // cannot tell which is nearer (no drive hours, or the same: Iora Retreat, Jorhat or Guwahati)
    if (airportUnclear(options, ctx.properties.find((p) => p.id === e.propertyId)?.kind)) {
      const park = e.park.replace(/\s+(national park|tiger reserve|wildlife sanctuary)$/i, "");
      const names = options.map((o) => cityOfAirport(o.name));
      asks.push({
        key: `airport:${e.park}`,
        text: `Which airport for ${park}: ${options.map((o) => `${cityOfAirport(o.name)}${o.hours < 99 ? ` (about ${o.hours} h drive)` : ""}`).join(" or ")}? I have taken ${city} for now.`,
        quick: names,
      });
    }
    return city;
  };

  const out: (RouteFlight & { pos: number })[] = input.flights.map((f) => ({ ...f }));
  const sideHas = (e: RouteEntry, city: string) => (e.kind === "city" ? sameCity(e.city, city) : cityNearLodge(city, e));
  let arrival: string | null | undefined;
  let departure: string | null | undefined;
  const firstLodge = entries.findIndex((e) => e.kind === "lodge");
  const lastLodge = entries.length - 1 - [...entries].reverse().findIndex((e) => e.kind === "lodge");

  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    if (joined(a, b)) continue;
    // two cities with a flight written out of the first (Khajuraho for the Delhi flight, then the
    // drive to Agra): that connecting flight is the way; nothing is added
    if (a.kind === "city" && b.kind === "city" && out.some((f) => sameCity(f.from, a.city) && f.pos >= a.pos - 5 && f.pos <= b.pos + 5)) continue;
    // the flight already written for this leg, if any
    const written = out.filter((f) => f.pos >= a.pos - 5 && f.pos <= b.pos + 5 && sideHas(a, f.from) && sideHas(b, f.to));
    const window = cityMentions.filter((m) => m.at > a.pos && m.at < b.pos);
    let from: string | null;
    let to: string | null;
    if (written.length) {
      from = written[0].from;
      to = written[written.length - 1].to;
      if (a.kind === "lodge") chosen.set(a.park, from);
      if (b.kind === "lodge") chosen.set(b.park, to);
    } else {
      from = a.kind === "city" ? a.city : lodgeCity(a, window, []);
      to = b.kind === "city" ? b.city : lodgeCity(b, window, []);
      // the same flight written elsewhere in the text (before the city night it leaves from) is that flight
      if (from && to && !sameCity(from, to) && !out.some((f) => sameCity(f.from, from!) && sameCity(f.to, to!))) out.push({ from, to, pos: Math.round((a.pos + b.pos) / 2) });
    }
    if (i === firstLodge && b.kind === "lodge") arrival = to ? airportName(to, b) : null;
    if (i - 1 === lastLodge && a.kind === "lodge") departure = from ? airportName(from, a) : null;
  }

  function airportName(city: string, e: Extract<RouteEntry, { kind: "lodge" }>) {
    const loc = locOfProperty(e.propertyId);
    const all = airportsOfCity(city);
    const linked = all.find((l) => rates.some((t) => (t.from_location_id === l.id && t.to_location_id === loc) || (t.to_location_id === l.id && t.from_location_id === loc)));
    return (linked ?? all[0])?.name ?? null;
  }

  out.sort((x, y) => x.pos - y.pos);
  return { flights: out.map(({ pos: _pos, ...f }) => f), arrival, departure, asks };
}
