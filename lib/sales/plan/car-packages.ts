// =====================================================================
// Outstation car packages (Master data > Outstation car packages, sales_car_packages):
// one price for the car over a whole road trip from a city and back, e.g.
//   Delhi - Agra - Delhi, 1 night / 2 days        Rs 21,000
//   Delhi - Agra - Jaipur - Delhi, 4 nights / 5 days  Rs 50,000
// When the trip's drives make exactly that trip (they leave the first city, visit the cities in
// that order and come back to it; the nights between leaving and coming back), the package is
// priced once and those drives are not priced one by one. Anything else (another order, more
// nights than any package) is not guessed: each drive is priced on its own as before.
// Pure, so it is tested without a database.
// =====================================================================
import type { CarPackage, ISODate } from "@/lib/sales/pricing/types";
import { sameCity, cityParkIds, isCityHotel } from "./cities";
import type { BuilderContext, Plan, PlanDay, PlanItem } from "./types";

// "Delhi - Agra - Jaipur - Delhi", "Delhi, Agra, Delhi", "Delhi > Agra > Delhi"
export function parseCities(route: string): string[] {
  return route
    .split(/\s*(?:-|,|>|\bto\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

const nightsBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// The city a place is in: a city hotel's city (as typed, else its place in Parks), an airport /
// station / city by its name. A lodge is in no city (a drive to a lodge is never in a package).
export function cityOfPlace(ctx: BuilderContext, locationId: string, label?: string): string | null {
  if (locationId.startsWith("@")) return label ? label.replace(/^hotel in\s+/i, "").trim() || null : null;
  const loc = ctx.locations.find((l) => l.id === locationId);
  if (!loc) return null;
  if (loc.property_id) {
    const p = ctx.properties.find((x) => x.id === loc.property_id);
    if (!p || !isCityHotel(p, cityParkIds(ctx))) return null;
    return p.city || ctx.pricing.parks.find((k) => k.id === p.park_id)?.name || null;
  }
  return loc.name;
}

interface Leg {
  day: number; // index in days
  date: ISODate;
  kind: "lodge" | "city";
  k: number; // index in city_transfers
  from: string | null;
  to: string | null;
}

// The package for this trip: the same cities in the same order, the same nights, valid on the
// day they leave; the chosen vehicle first, else the cheapest.
export function findCarPackage(pkgs: CarPackage[], cities: string[], nights: number, date: ISODate, vehicle?: string | null): CarPackage | null {
  const fits = pkgs.filter(
    (p) =>
      p.active &&
      p.nights === nights &&
      p.cities.length === cities.length &&
      p.cities.every((c, i) => sameCity(c, cities[i])) &&
      (!p.valid_from || p.valid_from <= date) &&
      (!p.valid_to || p.valid_to >= date)
  );
  const sameVehicle = vehicle ? fits.filter((p) => p.vehicle_type.toLowerCase() === vehicle.toLowerCase()) : [];
  return (sameVehicle.length ? sameVehicle : fits).sort((a, b) => a.rate - b.rate)[0] ?? null;
}

export function applyCarPackages(plan: Plan, days: PlanDay[], ctx: BuilderContext): PlanDay[] {
  const pkgs = (ctx.pricing.carPackages ?? []).filter((p) => p.active && p.cities.length >= 3);
  if (!pkgs.length || plan.own_vehicle) return days;
  const bases = pkgs.map((p) => p.cities[0]);
  const isBase = (c: string | null) => !!c && bases.some((b) => sameCity(b, c));

  // every drive of the trip, in day order
  const legs: Leg[] = [];
  days.forEach((d, i) => {
    if (d.transfer) legs.push({ day: i, date: d.date, kind: "lodge", k: -1, from: cityOfPlace(ctx, d.transfer.from_location_id), to: cityOfPlace(ctx, d.transfer.to_location_id) });
    (d.city_transfers ?? []).forEach((t, k) => legs.push({ day: i, date: d.date, kind: "city", k, from: cityOfPlace(ctx, t.from_location_id, t.from_label), to: cityOfPlace(ctx, t.to_location_id, t.to_label) }));
  });

  const out = days.map((d) => ({ ...d, items: [...d.items], notes: [...d.notes], city_transfers: d.city_transfers ? d.city_transfers.map((t) => ({ ...t })) : d.city_transfers }));
  for (let i = 0; i < legs.length; i++) {
    const start = legs[i];
    // leaving a base city (Delhi) by road for another city
    if (start.kind !== "city" || !isBase(start.from) || !start.to || sameCity(start.from!, start.to)) continue;
    const base = bases.find((b) => sameCity(b, start.from!)) ?? start.from!;
    const visited = [start.to];
    let end = -1;
    for (let j = i + 1; j < legs.length; j++) {
      const l = legs[j];
      if (l.kind !== "city" || !l.from || !l.to) break; // a lodge on the way: not an outstation trip
      const last = visited[visited.length - 1];
      if (!sameCity(l.from, last)) break; // a flight in between: not one road trip
      if (sameCity(l.to, base)) {
        end = j;
        break;
      }
      if (!sameCity(l.to, last)) visited.push(l.to);
    }
    if (end < 0) continue;
    const back = legs[end];
    const nights = nightsBetween(start.date, back.date);
    const cities = [base, ...visited, base];
    const pkg = findCarPackage(pkgs, cities, nights, start.date, plan.vehicle_type);
    if (!pkg) {
      out[start.day].notes.push(`No outstation car package for ${cities.join(" - ")}, ${nights} night${nights === 1 ? "" : "s"} in Master data: each drive is priced on its own.`);
      i = end;
      continue;
    }
    for (let j = i; j <= end; j++) {
      const t = out[legs[j].day].city_transfers?.[legs[j].k];
      if (t) t.package_id = pkg.id;
    }
    const item: PlanItem = {
      id: `auto-carpkg-${start.date}-${pkg.id}`,
      type: "transfer",
      title: `Outstation car: ${pkg.name}`,
      detail: `${pkg.vehicle_type}: the car for the whole road trip, every drive included`,
      price: null,
      addon_id: null,
      qty: null,
      car_package_id: pkg.id,
      auto: `carpkg:${start.date}:${pkg.id}`,
    };
    out[start.day].items.push(item);
    // sightseeing in the cities on the way (Agra sightseeing): by the package's car, no price of its own
    for (let x = start.day; x <= back.day; x++) {
      out[x].items = out[x].items.map((it) =>
        !it.addon_id && it.type === "activity" && /^cityextra:[^:]*:sightseeing$/.test(it.auto ?? "")
          ? { ...it, type: "note" as const, title: `${it.title} (by the outstation car, in the package)`, auto: `${it.auto}:carpkg` }
          : it
      );
    }
    i = end;
  }
  return out;
}
