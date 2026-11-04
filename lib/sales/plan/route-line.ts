// The places of a trip in travel order, for the guest page's "your route"
// (Delhi - Nagpur - Tadoba - Pench - Satpura - Bhopal - Delhi - Jorhat - Kaziranga - Jorhat - Delhi).
import { segments } from "./planner";
import { sameCity } from "./cities";
import { shortPark } from "./draft";
import type { Plan } from "./types";

export function routePath(plan: Plan, placeNames: Record<string, string>, parkNames: Record<string, string>): string[] {
  const segs = segments(plan);
  const flights = plan.flights ?? [];
  const cityOf = (place: string | undefined) => (place ?? "").replace(/\s*(international\s+)?(airport|railway station|station|junction)\b.*$/i, "").replace(/\s*\(.*\)\s*$/, "").trim();
  const path: string[] = [];
  const add = (x: string | undefined) => {
    const v = (x ?? "").trim();
    if (v && path[path.length - 1]?.toLowerCase() !== v.toLowerCase()) path.push(v);
  };
  const firstDay = plan.days.find((d) => d.kind !== "city");
  // each flight is used once, in trip order: the second Delhi stay is left by its own flight
  // (Delhi - Jorhat), never again by the first one (Delhi - Nagpur; Manav, 4 Nov 2026)
  const usedFlights = new Set<number>();
  const takeFlight = (pred: (f: (typeof flights)[number]) => boolean) => {
    const k = flights.findIndex((f, j) => !usedFlights.has(j) && pred(f));
    if (k < 0) return undefined;
    usedFlights.add(k);
    return flights[k];
  };
  segs.forEach((seg, k) => {
    const prev = segs[k - 1];
    if (seg.kind === "city") {
      const inFlight = prev?.kind === "lodge" ? takeFlight((f) => sameCity(f.to, seg.stay.city) && !segs.some((x) => x.kind === "city" && sameCity(x.stay.city, f.from))) : undefined;
      if (inFlight) add(inFlight.from);
      add(seg.stay.city || undefined);
      return;
    }
    if (k === 0 || prev?.kind === "city") {
      // reached by air (Delhi to Jabalpur) or from the arrival airport: that town first. The
      // drive into the lodge says where the guests land; the flight out of the city is used up.
      const flown = prev?.kind === "city" ? takeFlight((f) => sameCity(f.from, prev.stay.city)) : undefined;
      const inDay = plan.days.find((d) => d.date === seg.checkIn && d.property_id === seg.stop.property_id);
      const landed = inDay?.transfer ? cityOf(placeNames[inDay.transfer.from_location_id]) : "";
      if (prev?.kind === "city" && landed && !sameCity(landed, prev.stay.city)) add(landed);
      else if (flown) add(flown.to);
      else if (k === 0 && firstDay?.transfer) add(cityOf(placeNames[firstDay.transfer.from_location_id]));
    }
    add(shortPark(parkNames[seg.stop.park_id] ?? ""));
  });
  if (segs[segs.length - 1]?.kind === "lodge") {
    const lastDay = plan.days[plan.days.length - 1];
    if (lastDay?.transfer) {
      const out = cityOf(placeNames[lastDay.transfer.to_location_id]);
      add(out);
      // and the flight home from there (Jorhat - Delhi)
      const home = out ? takeFlight((f) => sameCity(f.from, out)) : undefined;
      if (home) add(home.to);
    }
  }
  return path;
}
