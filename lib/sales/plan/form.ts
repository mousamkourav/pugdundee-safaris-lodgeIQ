// =====================================================================
// "Build with a form": the trip put together one entry at a time, with no reading
// involved. Each helper adds one thing to the plan exactly as the chat would (a stop
// with what the guest wants there, a city night between two lodges, a flight); the
// planner then builds the days from it. Pure, so it is tested without a database.
// =====================================================================

import { findAddon, lodgesInPark, mealPlansOf, roomsOf } from "./planner";
import type { BuilderContext, CityStay, Plan, PlanStop } from "./types";

export interface FormStop {
  park_id: string;
  property_id: string;
  room_category_id: string;
  meal_plan?: string; // default: the room's first meal plan
  nights: number;
  safaris?: number | null; // jeep safaris in total here; empty = as many as fit
  naturalists?: number | null; // how many with a naturalist; -1 = all of them
  addon_ids?: string[]; // experiences at this lodge (add-ons from Master data)
}

// An experience as the planner looks it up (findAddon: all the words of its name).
const keywordOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function formStopProblems(ctx: BuilderContext, s: FormStop): string[] {
  const out: string[] = [];
  if (!ctx.pricing.parks.some((p) => p.id === s.park_id)) out.push("Choose a park.");
  else if (!lodgesInPark(ctx, s.park_id).some((l) => l.id === s.property_id)) out.push("Choose a lodge in that park.");
  else if (!roomsOf(ctx, s.property_id).some((r) => r.id === s.room_category_id)) out.push("Choose a room at that lodge.");
  if (!(Number.isInteger(s.nights) && s.nights >= 1 && s.nights <= 30)) out.push("Nights: 1 to 30.");
  if (s.safaris != null && !(Number.isInteger(s.safaris) && s.safaris >= 0 && s.safaris <= 30)) out.push("Safaris: 0 to 30.");
  if (s.naturalists != null && s.naturalists !== -1 && !(Number.isInteger(s.naturalists) && s.naturalists >= 0 && s.naturalists <= (s.safaris ?? 30))) out.push("Safaris with a naturalist: not more than the safaris.");
  return out;
}

// A stop at the end of the route, with what the guest wants there.
export function formAddStop(plan: Plan, ctx: BuilderContext, s: FormStop): Plan {
  if (formStopProblems(ctx, s).length) return plan;
  const meals = mealPlansOf(ctx, s.room_category_id);
  const extras = (s.addon_ids ?? [])
    .map((id) => ctx.pricing.addons.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => keywordOf(a.name))
    // only experiences the planner will find again at this lodge
    .filter((kw) => !!findAddon(ctx, s.property_id, kw, plan.guest.nationality));
  const stop: PlanStop = {
    park_id: s.park_id,
    property_id: s.property_id,
    room_category_id: s.room_category_id,
    meal_plan: s.meal_plan && meals.includes(s.meal_plan) ? s.meal_plan : meals[0] ?? "AP",
    nights: s.nights,
    ...(s.safaris != null ? { want_safaris: s.safaris } : {}),
    ...(s.naturalists != null ? { want_naturalists: s.naturalists } : {}),
    ...(extras.length ? { want_extras: [...new Set(extras)] } : {}),
  };
  return { ...plan, stops: [...plan.stops, stop] };
}

export interface FormCityNight {
  city: string;
  hotel?: string; // a hotel from Master data, or typed; empty = to be confirmed
  nights: number;
  after: number; // how many lodges come before it (0 = before the first lodge)
}

export function formAddCityNight(plan: Plan, c: FormCityNight): Plan {
  const city = c.city.trim();
  if (!city || !(Number.isInteger(c.nights) && c.nights >= 1 && c.nights <= 30)) return plan;
  const after = Math.max(0, Math.min(plan.stops.length, Math.round(c.after)));
  // before the first lodge: a night before the trip date (the trip date is the first lodge's day)
  const stay: CityStay = after === 0 ? { when: "before", city, nights: c.nights } : { when: "after", city, nights: c.nights, at: after };
  if (c.hotel?.trim()) stay.hotel = c.hotel.trim().slice(0, 120);
  return { ...plan, city_stays: [...(plan.city_stays ?? []), stay] };
}

export function formAddFlight(plan: Plan, f: { from: string; to: string; time?: string }): Plan {
  const from = f.from.trim();
  const to = f.to.trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return plan;
  const time = /^\d{1,2}:\d{2}$/.test(f.time ?? "") ? f.time : undefined;
  return { ...plan, flights: [...(plan.flights ?? []), { from, to, ...(time ? { time } : {}) }] };
}

// The experiences a lodge offers (its own add-ons and the Pugdundee-wide ones it offers),
// without meals, transfers and supplements: what the form lists as checkboxes.
export function formExperiences(ctx: BuilderContext, propertyId: string) {
  const skip = /breakfast|lunch|dinner with|meal|supplement|transfer|naturalist|full-day|maid|extra guest|accommodation/i;
  const park = ctx.properties.find((p) => p.id === propertyId)?.park_id ?? null;
  // its own, the ones kept for its park (Kaziranga camera fee), and the Pugdundee-wide ones it offers
  const here = (a: (typeof ctx.pricing.addons)[number]) =>
    a.property_id === propertyId || (!a.property_id && (a.park_id ? a.park_id === park : !a.offered_at?.length || a.offered_at.includes(propertyId)));
  return ctx.pricing.addons
    .filter((a) => a.active !== false && !a.alias && !skip.test(a.name) && here(a))
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
