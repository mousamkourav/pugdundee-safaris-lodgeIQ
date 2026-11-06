// =====================================================================
// Trip generator (owner, 5 Nov 2026): hundreds of trips made from the REAL Master data (real-fixture),
// written as a sales person writes them, read by the built-in reader, planned and priced, then checked
// against the travel rule book (travel-rules.ts) by an independent judge (judgeTrip). The judge does
// not call the planner's own helpers: it works out the road regions, the airports of each place and
// the roads with a rate from Master data itself, so a planner bug cannot hide behind the same bug.
//
// Deterministic (a seeded random): the same N trips every run, so a failure can be read again.
// =====================================================================
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan, planToTrip } from "./planner";
import { markConfirmed } from "./confirm";
import { quoteChecks } from "./checks";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { priceBreakdown } from "@/lib/sales/pricing/breakdown";
import type { PriceResult } from "@/lib/sales/pricing/types";
import type { BuilderContext, Plan, PlanDay } from "./types";
import { DOMESTIC_FLIGHT_FARE } from "./travel-rules";

// ---------------------------------------------------------------- seeded random

export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a: number, b: number) => a + Math.floor(next() * (b - a + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

// ---------------------------------------------------------------- what a trip is

export type Place = { kind: "lodge"; property_id: string; name: string; nights: number } | { kind: "city"; city: string; hotel: string | null; nights: number };

export interface TripSpec {
  n: number;
  text: string; // the enquiry as written
  places: Place[];
  adults: number;
  children: number[];
  rooms: number | null; // null: not said
  nationality: "indian" | "foreign";
  dateless: boolean;
  mode: "flight" | "train" | "own";
  airportsSaid: boolean; // the Kaziranga airport written ("fly to jorhat", "arriving guwahati")
}

// the lodges written by their own names (the reader knows each of them)
const LODGES = ["Kings Lodge", "Tree House Hideaway", "Kanha Earth Lodge", "Pench Tree Lodge", "Denwa Backwater Escape", "Ken River Lodge", "Waghoba Eco Lodge", "Iora Retreat"];
const CITY_HOTEL: Record<string, string | null> = { Delhi: null, Khajuraho: "Radisson Hotel Jass Khajuraho", Siliguri: "Mayfair Chumta", Agra: "ITC Mughal", Jaipur: "ITC Rajputana" };
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const GUESTS: { text: string; adults: number; rooms: number | null; kids: boolean }[] = [
  { text: "2 adults", adults: 2, rooms: null, kids: true },
  { text: "1 double", adults: 2, rooms: 1, kids: false },
  { text: "1 twin", adults: 2, rooms: 1, kids: false },
  { text: "couple", adults: 2, rooms: null, kids: true },
  { text: "honeymoon couple", adults: 2, rooms: null, kids: false },
  { text: "2 doubles", adults: 4, rooms: 2, kids: false },
  { text: "1 triple", adults: 3, rooms: 1, kids: false },
  { text: "single traveller", adults: 1, rooms: 1, kids: false },
  { text: "3 adults", adults: 3, rooms: null, kids: false },
  { text: "4 adults, 2 rooms", adults: 4, rooms: 2, kids: true },
];
const KIDS: { text: string; ages: number[] }[] = [
  { text: "2 children (7 and 12)", ages: [7, 12] },
  { text: "a child of 8", ages: [8] },
  { text: "2 bacche (7 aur 12 saal)", ages: [7, 12] },
];
const NATIONS: { text: string; nat: "indian" | "foreign" }[] = [
  { text: "from UK", nat: "foreign" },
  { text: "from USA", nat: "foreign" },
  { text: "from Germany", nat: "foreign" },
  { text: "indian", nat: "indian" },
  { text: "from Mumbai", nat: "indian" },
];

// ---------------------------------------------------------------- the judge's own view of Master data

export function masterView(ctx: BuilderContext) {
  const rates = ctx.pricing.transferRates.filter((r) => r.active !== false);
  const loc = (id: string) => ctx.locations.find((l) => l.id === id);
  const locOf = (propertyId: string) => ctx.locations.find((l) => l.property_id === propertyId)?.id ?? null;
  const hasRate = (a: string, b: string) => rates.some((r) => (r.from_location_id === a && r.to_location_id === b) || (r.bidirectional !== false && r.from_location_id === b && r.to_location_id === a));
  // road regions: places joined by a road with a rate (and the lodges of one park are one place)
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    adj.set(a, (adj.get(a) ?? new Set()).add(b));
    adj.set(b, (adj.get(b) ?? new Set()).add(a));
  };
  for (const r of rates) link(r.from_location_id, r.to_location_id);
  for (const p of ctx.properties)
    for (const q of ctx.properties)
      if (p.id !== q.id && p.park_id && p.park_id === q.park_id) {
        const a = locOf(p.id), b = locOf(q.id);
        if (a && b) link(a, b);
      }
  const region = new Map<string, string>();
  for (const start of adj.keys()) {
    if (region.has(start)) continue;
    const todo = [start];
    region.set(start, start);
    while (todo.length) for (const n of adj.get(todo.pop()!) ?? []) if (!region.has(n)) { region.set(n, start); todo.push(n); }
  }
  const delhiRegion = region.get(ctx.locations.find((l) => /^delhi airport/i.test(l.name))?.id ?? "") ?? "delhi";
  const cityHotelLoc = (city: string, hotel: string | null) => {
    const p = ctx.properties.find((x) => (hotel ? x.name === hotel : x.kind === "city_hotel" && (x.city ?? "").toLowerCase() === city.toLowerCase()));
    return p ? locOf(p.id) : null;
  };
  // Agra and Jaipur: a road trip from Delhi (the owner's rule), so Delhi's region
  const regionOfPlace = (p: Place): string | null => {
    if (p.kind === "lodge") return region.get(locOf(p.property_id) ?? "") ?? null;
    if (p.city === "Agra" || p.city === "Jaipur" || p.city === "Delhi") return delhiRegion;
    return region.get(cityHotelLoc(p.city, p.hotel) ?? "") ?? null;
  };
  // the city of an airport ("Delhi Airport (IGI)" -> Delhi)
  const airportCity = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(international|domestic|airport)\b/gi, "").trim();
  const airports = ctx.locations.filter((l) => l.type === "airport");
  // two airport places for one city ("Delhi", "Delhi Airport (IGI)"): the one with roads
  const airportByCity = (city: string) => {
    const all = airports.filter((a) => airportCity(a.name).toLowerCase() === city.toLowerCase());
    return all.find((a) => region.has(a.id)) ?? all[0];
  };
  return { rates, loc, locOf, hasRate, region, regionOfPlace, cityHotelLoc, airportCity, airports, airportByCity, delhiRegion };
}
export type MasterView = ReturnType<typeof masterView>;

// ---------------------------------------------------------------- making trips

export function makeTrip(n: number, r: Rng, ctx: BuilderContext, mv: MasterView): TripSpec {
  const lodgeIds = Object.fromEntries(LODGES.map((name) => [name, ctx.properties.find((p) => p.name === name)!.id]));
  const nLodges = r.pick([1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6]);
  const lodges: Place[] = [];
  while (lodges.length < nLodges) {
    const name = r.pick(LODGES);
    if (lodges.some((l) => l.kind === "lodge" && l.name === name)) continue;
    // Iora Retreat at most once, never two Kaziranga legs to plan by hand
    lodges.push({ kind: "lodge", property_id: lodgeIds[name], name, nights: r.int(1, 4) });
  }
  const central = lodges.every((l) => l.kind === "lodge" && l.name !== "Iora Retreat");
  let mode: TripSpec["mode"] = central && r.chance(0.12) ? "own" : central && r.chance(0.12) ? "train" : "flight";
  const places: Place[] = [...lodges];
  if (mode === "flight") {
    const city = (c: string): Place => ({ kind: "city", city: c, hotel: CITY_HOTEL[c], nights: r.int(1, 2) });
    if (r.chance(0.45)) places.unshift(city(r.pick(["Delhi", "Delhi", "Khajuraho"])));
    if (lodges.length > 1 && r.chance(0.35)) places.splice(r.int(1, lodges.length - 1) + (places[0].kind === "city" ? 1 : 0), 0, city(r.pick(["Delhi", "Delhi", "Khajuraho", "Siliguri"])));
    if (r.chance(0.5)) {
      const end = r.pick(["Delhi", "Delhi", "Siliguri", "Khajuraho", "Delhi-Agra-Jaipur"]);
      if (end === "Delhi-Agra-Jaipur") places.push(city("Delhi"), city("Agra"), city("Jaipur"));
      else places.push(city(end));
    }
    // never the same city twice in a row
    for (let i = places.length - 1; i > 0; i--) {
      const a = places[i - 1], b = places[i];
      if (a.kind === "city" && b.kind === "city" && a.city === b.city) places.splice(i, 1);
    }
  }
  const g = r.pick(GUESTS);
  const kids = g.kids && r.chance(0.3) ? r.pick(KIDS) : null;
  const nat = r.pick(NATIONS);
  const dateless = r.chance(0.2);
  const d = new Date(Date.UTC(2026, 10, 25) + r.int(0, 190) * 86_400_000);
  const date = dateless ? "dates not fixed" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const nightsWord = () => (r.chance(0.1) ? "nigths" : "nights");
  const parts: string[] = [];
  let airportsSaid = false;
  places.forEach((p, i) => {
    const prev = places[i - 1];
    if (p.kind === "lodge") {
      // Kaziranga: the airport written half the time ("fly to jorhat"), else asked once
      if (p.name === "Iora Retreat" && r.chance(0.5)) {
        parts.push(`${i === 0 ? "arriving" : "fly to"} ${r.pick(["jorhat", "guwahati"])}`);
        airportsSaid = true;
      }
      parts.push(r.chance(0.5) ? `${p.nights} ${p.nights === 1 ? "night" : nightsWord()} ${p.name.toLowerCase()}` : `${p.name.toLowerCase()} ${p.nights} ${p.nights === 1 ? "night" : nightsWord()}`);
    } else {
      const w = p.nights === 1 ? "night" : "nights";
      const drive = prev?.kind === "city" && ["Agra", "Jaipur"].includes(p.city);
      parts.push(drive ? `drive to ${p.city.toLowerCase()} ${p.nights} ${w}${p.hotel ? ` at ${p.hotel.toLowerCase()}` : ""}` : `${p.nights} ${w} ${p.city.toLowerCase()}${p.hotel ? ` at ${p.hotel.toLowerCase()}` : ""}`);
    }
  });
  if (places[places.length - 1].kind === "city" && (places[places.length - 1] as { city: string }).city === "Jaipur") parts.push("drive back to delhi for the flight home");
  let ends = "";
  const first = places[0], last = places[places.length - 1];
  if (mode === "own") ends = ", coming by own car";
  else if (mode === "train") {
    // a station with a road to both end lodges
    const fl = mv.locOf((first as { property_id: string }).property_id), ll = mv.locOf((last as { property_id: string }).property_id);
    const st = ctx.locations.find((l) => l.type === "railway" && fl && ll && mv.hasRate(l.id, fl) && mv.hasRate(l.id, ll));
    if (st) ends = `, arriving and departing by train at ${st.name.replace(/\s*railway station/i, "").replace(/\s*\(.*\)/, "").toLowerCase()}`;
    else mode = "flight"; // no station serves both ends: they fly (no city nights were added for a train trip)
  } else if (first.kind === "lodge" && last.kind === "lodge" && first.name !== "Iora Retreat" && last.name !== "Iora Retreat" && r.chance(0.5)) {
    const nearest = (pid: string) => {
      const l = mv.locOf(pid)!;
      return mv.rates.filter((t) => [t.from_location_id, t.to_location_id].includes(l)).map((t) => mv.loc(t.from_location_id === l ? t.to_location_id : t.from_location_id)!).filter((x) => x?.type === "airport").sort((a, b) => a.name.localeCompare(b.name))[0];
    };
    const a = nearest(first.property_id), b = nearest(last.property_id);
    if (a && b) {
      ends = `, arriving ${mv.airportCity(a.name).toLowerCase()} and departing ${mv.airportCity(b.name).toLowerCase()}`;
    }
  }
  const text = `${g.text}${kids ? ` + ${kids.text}` : ""} ${nat.text}, ${date}, ${parts.join(", then ")}${ends}`;
  return { n, text, places, adults: g.adults, children: kids?.ages ?? [], rooms: g.rooms, nationality: nat.nat, dateless, mode, airportsSaid };
}

export function makeTrips(count: number, ctx: BuilderContext, seed = 20261105): TripSpec[] {
  const r = rng(seed);
  const mv = masterView(ctx);
  return Array.from({ length: count }, (_, i) => makeTrip(i + 1, r, ctx, mv));
}

// ---------------------------------------------------------------- the judge

export type FailKind =
  | "read: lodges"
  | "read: city nights"
  | "read: guests"
  | "read: nationality / dates"
  | "question not needed"
  | "Kaziranga airport not asked once"
  | "days not continuous"
  | "lodge without a way in"
  | "lodge without a way out"
  | "road between regions"
  | "hotel to another city's airport"
  | "regions not joined by a flight"
  | "flight not between airports"
  | "flight not Rs 15,000 per person"
  | "price needed although Master data has the rate"
  | "price needed (other)"
  | "breakup does not add up"
  | "engine error"
  | "hard check";

export interface Verdict {
  fails: { kind: FailKind; detail: string }[];
  missingRoads: string[]; // genuinely missing in Master data: "Kanha Earth Lodge - Waghoba Eco Lodge"
  missingRates: string[]; // a room with no rate for the night in Master data
  plan: Plan;
  result: PriceResult;
}

const T = "2026-11-05";
const dayTransfers = (d: PlanDay) => [...(d.transfer ? [d.transfer] : []), ...(d.city_transfers ?? [])];

// The enquiry, then the questions a sales person answers with the first choice offered (the room at a
// lodge with several kinds, the Kaziranga airport): every question asked is listed.
export function readTrip(spec: TripSpec, ctx: BuilderContext): { plan: Plan; flags: ChatFlags; questions: string[] } {
  const p0 = emptyPlan(T);
  let r = chatTurn(p0, initialFlags(p0), spec.text, ctx, T);
  const questions: string[] = [];
  for (let i = 0; i < 8 && r.flags.pending; i++) {
    const q = `${r.flags.pending}${r.flags.askFor ? `:${r.flags.askFor}` : ""}: ${r.reply.text.split("\n")[0].slice(0, 120)}`;
    questions.push(q);
    const choice = r.reply.quick?.find((x) => !x.action);
    const answer = choice?.text ?? choice?.label;
    if (!ANSWERABLE(q) || !answer) break;
    r = chatTurn(r.plan, r.flags, answer, ctx, T);
  }
  return { plan: r.plan, flags: r.flags, questions };
}

// questions a sales person can rightly be asked: the room at a lodge with several kinds, the Kaziranga
// airport when the enquiry does not say it (asked once)
// airport when the enquiry does not say it (asked once), our car or theirs between lodges when they come
// by their own car; the guest's name is the chat's last step (not needed for the trip, never blocks it)
const ANSWERABLE = (q: string) => /^room\b/.test(q) || /^ask:airport:Kaziranga/.test(q) || /^leg\b/.test(q);
export const NEEDED_QUESTION = (spec: TripSpec, q: string) =>
  /^(room|name)\b/.test(q) ||
  (/^leg\b/.test(q) && spec.mode === "own") ||
  (/^ask:airport:Kaziranga/.test(q) && spec.places.some((p) => p.kind === "lodge" && p.name === "Iora Retreat") && !spec.airportsSaid);

export function judgeTrip(spec: TripSpec, ctx: BuilderContext, mv: MasterView = masterView(ctx)): Verdict {
  const fails: Verdict["fails"] = [];
  const fail = (kind: FailKind, detail: string) => fails.push({ kind, detail });
  const { plan, questions } = readTrip(spec, ctx);
  const nameOf = (id: string) => mv.loc(id)?.name ?? id;

  // ---- the reading
  const lodges = spec.places.filter((p): p is Extract<Place, { kind: "lodge" }> => p.kind === "lodge");
  const gotStops = plan.stops.map((s) => `${s.property_id}x${s.nights}`).join(",");
  const wantStops = lodges.map((l) => `${l.property_id}x${l.nights}`).join(",");
  if (gotStops !== wantStops) fail("read: lodges", `want ${wantStops} got ${gotStops}`);
  const cities = spec.places.filter((p): p is Extract<Place, { kind: "city" }> => p.kind === "city");
  const gotCities = (plan.city_stays ?? []).filter((c) => !c.blank).map((c) => `${c.city}x${c.nights}`).sort().join(",");
  const wantCities = cities.map((c) => `${c.city}x${c.nights}`).sort().join(",");
  if (gotCities !== wantCities) fail("read: city nights", `want ${wantCities} got ${gotCities}`);
  if (plan.guest.adults !== spec.adults || plan.guest.children.join(",") !== spec.children.join(",") || (spec.rooms != null && plan.guest.rooms !== spec.rooms))
    fail("read: guests", `want ${spec.adults}a [${spec.children}] ${spec.rooms ?? "-"}r got ${plan.guest.adults}a [${plan.guest.children}] ${plan.guest.rooms}r`);
  if (plan.guest.nationality !== spec.nationality || !!plan.dateless !== spec.dateless) fail("read: nationality / dates", `want ${spec.nationality} dateless=${spec.dateless} got ${plan.guest.nationality} dateless=${!!plan.dateless}`);
  for (const q of questions) if (!NEEDED_QUESTION(spec, q)) fail("question not needed", q);
  // the Kaziranga airport, not written: asked once (owner, 5 Nov 2026)
  const iora = spec.places.some((p) => p.kind === "lodge" && p.name === "Iora Retreat");
  const airportQs = questions.filter((q) => /^ask:airport:Kaziranga/.test(q)).length;
  if (iora && !spec.airportsSaid && airportQs !== 1) fail("Kaziranga airport not asked once", `asked ${airportQs} times`);

  // ---- the days
  const nights = spec.places.reduce((t, p) => t + p.nights, 0);
  if (plan.days.length !== nights + 1) fail("days not continuous", `${plan.days.length} days for ${nights} nights`);
  for (let i = 1; i < plan.days.length; i++) {
    const a = Date.parse(plan.days[i - 1].date), b = Date.parse(plan.days[i].date);
    if (b - a !== 86_400_000) fail("days not continuous", `${plan.days[i - 1].date} > ${plan.days[i].date}`);
  }

  // ---- every road and every flight
  const own = !!plan.own_vehicle;
  for (const d of plan.days) {
    for (const t of dayTransfers(d)) {
      const a = mv.loc(t.from_location_id), b = mv.loc(t.to_location_id);
      if (!a || !b) continue; // a place typed by hand ("@their hotel")
      const ra = mv.region.get(a.id), rb = mv.region.get(b.id);
      if (ra && rb && ra !== rb) fail("road between regions", `${d.date} ${a.name} > ${b.name}`);
      // a city hotel and an airport: the airport must be the hotel's city's (named after it, or a road to it)
      for (const [h, ap] of [[a, b], [b, a]] as const) {
        const hotel = h.type === "property" ? ctx.properties.find((p) => p.id === h.property_id && p.kind === "city_hotel") : undefined;
        if (!hotel || ap.type !== "airport") continue;
        // ...or the road trip back to Delhi for the flight (Agra / Jaipur - Delhi, the owner's road trip pairs)
        const roadTrip = /^(agra|jaipur)$/i.test(hotel.city ?? "") && /^delhi$/i.test(mv.airportCity(ap.name));
        const serves = mv.airportCity(ap.name).toLowerCase() === (hotel.city ?? "").toLowerCase() || mv.hasRate(h.id, ap.id) || roadTrip;
        if (!serves) fail("hotel to another city's airport", `${d.date} ${a.name} > ${b.name}`);
      }
    }
  }
  const flights = plan.days.flatMap((d) => d.items.filter((i) => i.type === "flight").map((i) => ({ d, i })));
  for (const { d, i } of flights) {
    const f = i.flight!;
    if (!mv.airportByCity(f.from) || !mv.airportByCity(f.to)) fail("flight not between airports", `${d.date} ${f.from} > ${f.to}`);
  }
  // two places in a row in different regions: a flight from the first's side to the second's
  const sideOf = (city: string) => mv.region.get(mv.airportByCity(city)?.id ?? "") ?? (/^(agra|jaipur)$/i.test(city) ? mv.delhiRegion : null);
  for (let k = 1; k < spec.places.length; k++) {
    const A = spec.places[k - 1], B = spec.places[k];
    const ra = mv.regionOfPlace(A), rb = mv.regionOfPlace(B);
    if (!ra || !rb || ra === rb) continue;
    if (!flights.some(({ i }) => sideOf(i.flight!.from) === ra && sideOf(i.flight!.to) === rb))
      fail("regions not joined by a flight", `${A.kind === "lodge" ? A.name : A.city} > ${B.kind === "lodge" ? B.name : B.city}`);
  }

  // ---- a way in and out of every lodge
  if (!own) {
    let at = 0;
    for (const p of spec.places) {
      if (p.kind === "lodge") {
        const loc = mv.locOf(p.property_id);
        const inDay = plan.days[at], outDay = plan.days[at + p.nights];
        const into = inDay && (inDay.own_vehicle || dayTransfers(inDay).some((t) => t.to_location_id === loc));
        const outOf = outDay && (outDay.own_vehicle || dayTransfers(outDay).some((t) => t.from_location_id === loc));
        if (!into) fail("lodge without a way in", `${p.name} on ${inDay?.date ?? "?"}`);
        if (!outOf) fail("lodge without a way out", `${p.name} on ${outDay?.date ?? "?"}`);
      }
      at += p.nights;
    }
  }

  // ---- the price
  const confirmed = markConfirmed(plan, T);
  const trip = planToTrip(confirmed, T);
  const result = priceTrip(trip, ctx.pricing);
  const pax = plan.guest.adults + plan.guest.children.length;
  for (const { i } of flights) {
    const line = result.lines.find((l) => l.description === i.title && (l as { group?: string }).group === "flight");
    if (!line || line.amount !== DOMESTIC_FLIGHT_FARE * pax) fail("flight not Rs 15,000 per person", `${i.title}: ${line ? line.amount : "no price"} for ${pax}`);
  }
  const missingRoads: string[] = [];
  const missingRates: string[] = [];
  // a room with no rate row covering the night in Master data is missing data, not a reading or route fault
  const roomRated = (label: string, date: string | null) => {
    const room = ctx.rooms.find((r) => label.startsWith(`${r.name} at ${ctx.properties.find((p) => p.id === r.property_id)?.name}`));
    if (!room) return true;
    return ctx.pricing.roomRates.some((x) => x.room_category_id === room.id && x.active !== false && (!date || ((!x.valid_from || x.valid_from <= date) && (!x.valid_to || x.valid_to >= date))));
  };
  for (const m of result.missing) {
    if (m.kind === "transfer") {
      const [, , from, to] = m.key.split("|");
      if (mv.hasRate(from, to)) fail("price needed although Master data has the rate", m.label);
      else missingRoads.push(`${nameOf(from)} - ${nameOf(to)}`);
    } else if (m.kind === "room" && [m.date, ...result.lines.filter((l) => l.missing && l.key === m.key).map((l) => l.date)].some((d) => !roomRated(m.label, d ?? null)))
      missingRates.push(`${m.label} on ${m.date ?? "(no date)"}`);
    else if (!/sightseeing|guide|entrance/i.test(m.label)) fail("price needed (other)", m.label);
  }
  if (result.errors.length) fail("engine error", result.errors.join("; "));
  const sum = result.lines.reduce((t, l) => t + l.amount, 0);
  if (Math.abs(sum - result.totals.grand) > 1 || Math.abs(priceBreakdown(result).total - result.totals.grand) > 1) fail("breakup does not add up", `lines ${sum}, breakup ${priceBreakdown(result).total}, total ${result.totals.grand}`);
  for (const c of quoteChecks(confirmed, ctx, result)) {
    // a price to type for a road Master data does not have is the one check that is right to stop a quote
    if (/^Price needed: Transfer /.test(c) && !fails.some((f) => f.kind === "price needed although Master data has the rate")) continue;
    if (/^Price needed: .*(sightseeing|guide|entrance)/i.test(c)) continue;
    if (missingRates.some((m) => c.includes(m.split(" on ")[0]))) continue;
    fail("hard check", c);
  }
  return { fails, missingRoads, missingRates, plan, result };
}
