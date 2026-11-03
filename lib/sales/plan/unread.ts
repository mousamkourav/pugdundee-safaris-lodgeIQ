// =====================================================================
// Nothing in the enquiry is dropped silently (3 Nov 2026).
// Every place the enquiry names (a park, a lodge, a city) and every "N nights / N days" must be
// in the trip that was built. What is not is listed in plain words on the Confirm step and in
// the chat ("Not in the trip: 'agra and jaipur for 4 days'"), so a misreading is seen at once,
// whoever read the message (the AI, the reader or memory). Pure, so it is tested without a database.
// =====================================================================
import { extractTrip, type Mentions } from "./parse-text";
import { cityHotels, sameCity } from "./cities";
import { segments } from "./planner";
import type { BuilderContext, Plan } from "./types";

export interface Unread {
  quote: string; // the words of the enquiry, as read
  why: string; // "Agra is not in the trip"
}

const CLAUSE = /[,.;!?\n]|\b(?:then|than|after that|next|phir|fir|and then)\b/g;

export function unreadParts(enquiry: string | undefined, plan: Plan, ctx: BuilderContext, today = "2026-01-01"): Unread[] {
  if (!enquiry || enquiry.trim().length < 15 || !plan.stops.length) return [];
  let m: Mentions | undefined;
  try {
    m = extractTrip(enquiry, ctx, today, cityHotels(ctx)).mentions;
  } catch {
    return [];
  }
  if (!m) return [];
  const low = m.text;
  const out: Unread[] = [];
  const parkOf = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name;
  const lodgeOf = (id: string) => ctx.properties.find((p) => p.id === id)?.name;
  const segs = segments(plan);

  // ---- the places
  const locName = (id: string | null | undefined) => (id ? ctx.locations.find((l) => l.id === id)?.name ?? "" : "");
  const cityUsed = (city: string) =>
    (plan.city_stays ?? []).some((c) => !!c.city && sameCity(c.city, city)) ||
    (plan.flights ?? []).some((f) => sameCity(f.from, city) || sameCity(f.to, city)) ||
    (!!plan.end_city && sameCity(plan.end_city, city)) ||
    [plan.arrival_location_id, plan.departure_location_id].some((id) => !!locName(id) && sameCity(locName(id), city)) ||
    // a park of that name (Delhi in Master data), or a place the trip's days drive to or from
    plan.stops.some((s) => sameCity(parkOf(s.park_id) ?? "", city)) ||
    plan.days.some((d) => [d.transfer?.from_location_id, d.transfer?.to_location_id, ...(d.city_transfers ?? []).flatMap((t) => [t.from_location_id, t.to_location_id])].some((id) => !!locName(id) && sameCity(locName(id), city)));
  const seenPlace = new Set<string>();
  const hotelCities = cityHotels(ctx).map((h) => h.city);
  const knownCity = (city: string) =>
    hotelCities.some((c) => sameCity(c, city)) || ctx.locations.some((l) => l.type !== "property" && sameCity(l.name, city)) || ctx.pricing.parks.some((p) => sameCity(p.name, city));
  for (const p of m.places) {
    const quote = low.slice(p.at, p.end);
    if (p.city) {
      // a city Master data does not know (Mumbai: where the guests come from) cannot be a stop;
      // a night written there is still checked below
      if (!knownCity(p.city)) continue;
      if (!cityUsed(p.city) && !seenPlace.has(`c:${p.city}`)) {
        seenPlace.add(`c:${p.city}`);
        out.push({ quote, why: `${p.city} is not in the trip` });
      }
      continue;
    }
    const park = ctx.pricing.parks.find((x) => x.name === p.park);
    if (!park) continue;
    if (p.lodge) {
      // a city hotel (Roseate House) is in the trip as a city night's hotel
      const asHotel = (plan.city_stays ?? []).some((c) => (c.hotel ?? "").toLowerCase() === p.lodge!.toLowerCase());
      if (!asHotel && !plan.stops.some((s) => lodgeOf(s.property_id) === p.lodge) && !seenPlace.has(`l:${p.lodge}`)) {
        seenPlace.add(`l:${p.lodge}`);
        out.push({ quote, why: `${p.lodge} is not in the trip` });
      }
    } else if (!plan.stops.some((s) => s.park_id === park.id) && !cityUsed(park.name) && !seenPlace.has(`p:${park.name}`)) {
      seenPlace.add(`p:${park.name}`);
      out.push({ quote, why: `${park.name} is not in the trip` });
    }
  }

  // ---- the nights: each count belongs to the places of its own clause
  // the nights a place has in the trip: each of its stays, and all of them together
  const nightsOfPlace = (p: Mentions["places"][number]): number[] => {
    const each = (xs: number[]) => (xs.length ? [...xs, xs.reduce((t, x) => t + x, 0)] : []);
    if (p.lodge) return each([...plan.stops.filter((s) => lodgeOf(s.property_id) === p.lodge).map((s) => s.nights), ...hotelNights(p.lodge)]);
    const park = p.park ? ctx.pricing.parks.find((x) => x.name === p.park) : undefined;
    const lodges = park ? plan.stops.filter((s) => s.park_id === park.id).map((s) => s.nights) : [];
    if (lodges.length) return each(lodges);
    const city = p.city ?? p.park ?? "";
    return each((plan.city_stays ?? []).filter((x) => !!x.city && sameCity(x.city, city)).map((x) => x.nights));
  };
  // a lodge night's hotel: Roseate House's nights are Delhi's
  const hotelNights = (lodge: string) => (plan.city_stays ?? []).filter((c) => (c.hotel ?? "").toLowerCase() === lodge.toLowerCase()).map((c) => c.nights);
  // every way a number of nights is in the trip: one stay, or a city's nights one by one
  const allNights = new Set<number>([
    ...plan.stops.map((s) => s.nights),
    ...(plan.city_stays ?? []).map((c) => c.nights),
    segs.reduce((t, s) => t + (s.kind === "lodge" ? s.stop.nights : s.stay.nights), 0),
  ]);
  const okFor = (n: number, days: boolean, have: number[]) =>
    have.some((h) => h === n || (days && (h === n - 1 || h === n))) || (days && allNights.has(n - 1)) || allNights.has(n);
  const clauseOf = (at: number) => {
    let start = 0;
    let end = low.length;
    for (const x of low.matchAll(CLAUSE)) {
      if (x.index! < at) start = x.index! + x[0].length;
      else if (x.index! > at) {
        end = x.index!;
        break;
      }
    }
    return [start, end] as const;
  };
  for (const c of m.counts) {
    // not a stay: "booking 30 days before", "120 days in advance", "one day per date"
    if (/^\s*(?:before|in advance|ahead|prior|ago|later|earlier|back|per|each|notice|of notice)\b/.test(low.slice(c.end, c.end + 15))) continue;
    if (/\b(?:book(?:ing|ed)?|within|last|next|every|per)\s+$/.test(low.slice(Math.max(0, c.at - 12), c.at))) continue;
    if (c.days && c.n === 1) continue;
    const [s, e] = clauseOf(c.at);
    const here = m.places.filter((p) => p.at >= s && p.at < e);
    const quote = low.slice(Math.max(s, Math.min(c.at, here[0]?.at ?? c.at)), Math.min(e, Math.max(c.end, ...here.map((p) => p.end)))).trim();
    if (!here.length) {
      // no place in its clause ("for 2 days and take a break"): any stay of that length
      if (!okFor(c.n, c.days, [])) out.push({ quote, why: `no stay of ${c.n} ${c.days ? "days" : "nights"} in the trip` });
      continue;
    }
    const per = here.map(nightsOfPlace);
    const has = (x: number) => x === c.n || (c.days && x === c.n - 1);
    // one place's stay, or several places together ("agra and jaipur for 4 days")
    const totals = per.filter((x) => x.length).map((x) => x[x.length - 1]);
    const ok = per.some((x) => x.some(has)) || (totals.length > 1 && has(totals.reduce((t, x) => t + x, 0)));
    if (!ok) {
      const names = here.map((p) => p.lodge ?? p.park ?? p.city).filter((x, i, a) => a.indexOf(x) === i);
      out.push({ quote, why: totals.length ? `the trip has ${totals.join(" + ")} night(s) for ${names.join(" and ")}` : `no stay at ${names.join(" or ")} in the trip` });
    }
  }
  return out;
}

// One line for the chat: "Not in the trip: "agra and jaipur for 4 days" (Agra is not in the trip); ..."
export const unreadText = (u: Unread[]) => (u.length ? `Not in the trip yet, please check: ${u.map((x) => `"${x.quote}" (${x.why})`).join("; ")}.` : "");
