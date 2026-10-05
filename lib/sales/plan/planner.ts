// Turns a route (parks + nights) into a day-by-day plan, and a plan into the
// TripInput the pricing engine needs. Pure functions; shared by the browser
// (live builder) and the server (save action).

import { addDays, dayName } from "@/lib/sales/pricing/dates";
import { closureFor } from "@/lib/sales/pricing/engine";
import type { ISODate, SafariInput, TransferInput, TripInput } from "@/lib/sales/pricing/types";
import type { BuilderContext, DaySafari, Plan, PlanDay, PlanStop } from "./types";

export const MEAL_ORDER = ["AP", "MAP", "CP", "EP"];

export function emptyPlan(today: ISODate): Plan {
  return {
    schema_version: 1,
    guest: { name: "", email: "", phone: "", nationality: "foreign", adults: 2, children: [], rooms: 1, source: "", agent_name: "", notes: "" },
    arrival_date: addDays(today, 90),
    arrival_location_id: null,
    departure_location_id: null,
    stops: [],
    days: [],
    vehicle_type: null,
    offer_ids: [],
    markup_pct: null,
    adjustment: null,
    currency: "INR",
  };
}

// ---------------- defaults ----------------

export function lodgesInPark(ctx: BuilderContext, parkId: string) {
  return ctx.properties
    .filter((p) => p.park_id === parkId)
    .sort((a, b) => a.fallback_priority - b.fallback_priority || a.sort - b.sort || a.name.localeCompare(b.name));
}

export function roomsOf(ctx: BuilderContext, propertyId: string) {
  return ctx.rooms.filter((r) => r.property_id === propertyId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function mealPlansOf(ctx: BuilderContext, roomId: string) {
  const plans = new Set(ctx.pricing.roomRates.filter((r) => r.room_category_id === roomId).map((r) => r.meal_plan));
  return MEAL_ORDER.filter((m) => plans.has(m));
}

export function defaultStop(ctx: BuilderContext, parkId: string, nights = 3): PlanStop {
  const lodge = lodgesInPark(ctx, parkId)[0];
  const room = lodge ? roomsOf(ctx, lodge.id)[0] : undefined;
  const meal = room ? mealPlansOf(ctx, room.id)[0] ?? "AP" : "AP";
  return { park_id: parkId, nights, property_id: lodge?.id ?? "", room_category_id: room?.id ?? "", meal_plan: meal };
}

// ---------------- day plan ----------------

const locationOfProperty = (ctx: BuilderContext, propertyId: string) => ctx.locations.find((l) => l.property_id === propertyId)?.id ?? null;

function hasBufferRate(ctx: BuilderContext, parkId: string, session: string) {
  return ctx.pricing.safariRates.some((r) => r.park_id === parkId && r.zone === "buffer" && r.session === session);
}

// Morning + afternoon in the core zone; if the core is closed for a session,
// use the buffer zone when it has rates, otherwise drop that session.
export function autoSafaris(ctx: BuilderContext, parkId: string, date: ISODate): { safaris: DaySafari[]; notes: string[] } {
  const safaris: DaySafari[] = [];
  const notes: string[] = [];
  for (const session of ["morning", "afternoon"] as const) {
    const core = closureFor(ctx.pricing, parkId, "core", session, date);
    if (!core) {
      safaris.push({ session, zone: "core" });
      continue;
    }
    const why = core.label ? ` (${core.label})` : "";
    const buffer = closureFor(ctx.pricing, parkId, "buffer", session, date);
    if (!buffer && hasBufferRate(ctx, parkId, session)) {
      safaris.push({ session, zone: "buffer" });
      notes.push(`Core zone closed ${dayName(date)} ${session}${why}; buffer zone used.`);
    } else {
      notes.push(`No ${session} safari: park closed ${dayName(date)}${why}.`);
    }
  }
  return { safaris, notes };
}

export function stopDates(plan: Pick<Plan, "arrival_date" | "stops">) {
  let d = plan.arrival_date;
  return plan.stops.map((s) => {
    const checkIn = d;
    d = addDays(d, s.nights);
    return { stop: s, checkIn, checkOut: d };
  });
}

export function buildDays(plan: Plan, ctx: BuilderContext): PlanDay[] {
  const days: PlanDay[] = [];
  const legs = stopDates(plan);
  const vehicle = plan.vehicle_type;

  legs.forEach(({ stop, checkIn }, i) => {
    const toLoc = locationOfProperty(ctx, stop.property_id);
    const fromLoc = i === 0 ? plan.arrival_location_id : locationOfProperty(ctx, legs[i - 1].stop.property_id);
    days.push(
      describe(ctx, {
        date: checkIn,
        kind: i === 0 ? "arrival" : "transfer",
        property_id: stop.property_id,
        park_id: stop.park_id,
        safaris: [],
        transfer: fromLoc && toLoc ? { from_location_id: fromLoc, to_location_id: toLoc } : null,
        title: "",
        text: "",
        notes: [],
      }, vehicle)
    );
    for (let n = 1; n < stop.nights; n++) {
      const date = addDays(checkIn, n);
      const { safaris, notes } = autoSafaris(ctx, stop.park_id, date);
      days.push(
        describe(ctx, {
          date,
          kind: safaris.length ? "safari" : "leisure",
          property_id: stop.property_id,
          park_id: stop.park_id,
          safaris,
          transfer: null,
          title: "",
          text: "",
          notes,
        }, vehicle)
      );
    }
  });

  if (legs.length) {
    const last = legs[legs.length - 1];
    const fromLoc = locationOfProperty(ctx, last.stop.property_id);
    days.push(
      describe(ctx, {
        date: last.checkOut,
        kind: "departure",
        property_id: null,
        park_id: last.stop.park_id,
        safaris: [],
        transfer: fromLoc && plan.departure_location_id ? { from_location_id: fromLoc, to_location_id: plan.departure_location_id } : null,
        title: "",
        text: "",
        notes: [],
      }, vehicle)
    );
  }
  return days;
}

// ---------------- titles and text ----------------

function driveHours(ctx: BuilderContext, from: string, to: string, vehicle: string | null) {
  const r = ctx.pricing.transferRates.find(
    (t) =>
      (!vehicle || t.vehicle_type === vehicle) &&
      ((t.from_location_id === from && t.to_location_id === to) || (t.bidirectional && t.from_location_id === to && t.to_location_id === from))
  );
  return r?.drive_hours ?? null;
}

const DEFAULT_TEXT: Record<PlanDay["kind"], string> = {
  arrival: "Arrive at {from} and drive to {lodge}{hours}. Evening at leisure.",
  transfer: "After breakfast, drive to {lodge} in {park}{hours}. Evening at leisure.",
  safari: "{safaris} in {park}, with a resident naturalist.",
  leisure: "A day at leisure at {lodge}.",
  departure: "After breakfast, drive to {to}{hours} for your onward journey.",
};

function pickTemplate(ctx: BuilderContext, kind: string, parkId: string | null, propertyId: string | null) {
  const list = ctx.templates.filter((t) => t.kind === `day_${kind}`);
  return (
    list.find((t) => propertyId && t.property_id === propertyId) ??
    list.find((t) => parkId && t.park_id === parkId && !t.property_id) ??
    list.find((t) => t.is_default && !t.park_id && !t.property_id) ??
    list.find((t) => !t.park_id && !t.property_id)
  );
}

function safariPhrase(s: DaySafari[]) {
  if (!s.length) return "No safaris";
  const sessions = s.length === 2 ? "Morning and evening jeep safaris" : `${s[0].session === "morning" ? "Morning" : "Evening"} jeep safari`;
  const zones = [...new Set(s.map((x) => x.zone))];
  return `${sessions} (${zones.join(" and ")} zone)`;
}

export function describe(ctx: BuilderContext, day: PlanDay, vehicle: string | null): PlanDay {
  const lodge = ctx.properties.find((p) => p.id === day.property_id)?.name ?? "";
  const park = ctx.pricing.parks.find((p) => p.id === day.park_id)?.name ?? "";
  const from = day.transfer ? ctx.locations.find((l) => l.id === day.transfer!.from_location_id)?.name ?? "" : "";
  const to = day.transfer ? ctx.locations.find((l) => l.id === day.transfer!.to_location_id)?.name ?? "" : "";
  const h = day.transfer ? driveHours(ctx, day.transfer.from_location_id, day.transfer.to_location_id, vehicle) : null;
  const hours = h ? ` (about ${h} hours)` : "";

  const titles: Record<PlanDay["kind"], string> = {
    arrival: from ? `Arrive ${from}, on to ${lodge}` : `Arrive at ${lodge}`,
    transfer: from ? `${from} to ${lodge}` : `On to ${lodge}`,
    safari: `Safaris in ${park}`,
    leisure: `At leisure in ${park}`,
    departure: to ? `Depart via ${to}` : "Departure",
  };

  const template = pickTemplate(ctx, day.kind, day.park_id, day.property_id)?.body ?? DEFAULT_TEXT[day.kind];
  const text = template
    .replaceAll("{lodge}", lodge)
    .replaceAll("{park}", park)
    .replaceAll("{from}", from || "the airport")
    .replaceAll("{to}", to || "your onward point")
    .replaceAll("{hours}", hours)
    .replaceAll("{safaris}", safariPhrase(day.safaris));

  return { ...day, title: titles[day.kind], text };
}

// ---------------- plan -> pricing input ----------------

export function planToTrip(plan: Plan, bookingDate: ISODate): TripInput {
  const stays = stopDates(plan).map(({ stop, checkIn }) => ({
    property_id: stop.property_id,
    room_category_id: stop.room_category_id,
    meal_plan: stop.meal_plan,
    check_in: checkIn,
    nights: stop.nights,
    rooms: plan.guest.rooms,
  }));
  const safaris: SafariInput[] = [];
  const transfers: TransferInput[] = [];
  for (const d of plan.days) {
    if (d.park_id) for (const s of d.safaris) safaris.push({ date: d.date, park_id: d.park_id, zone: s.zone, session: s.session });
    if (d.transfer) transfers.push({ date: d.date, ...d.transfer, vehicle_type: plan.vehicle_type ?? undefined });
  }
  return {
    adults: plan.guest.adults,
    children: plan.guest.children,
    nationality: plan.guest.nationality,
    stays,
    safaris,
    transfers,
    offer_ids: plan.offer_ids,
    markup_pct: plan.markup_pct,
    adjustment: plan.adjustment,
    currency: plan.currency,
    booking_date: bookingDate,
  };
}

// Problems with the route itself (before pricing).
export function routeProblems(plan: Plan, ctx: BuilderContext): string[] {
  const out: string[] = [];
  if (!plan.stops.length) out.push("Add at least one park.");
  plan.stops.forEach((s, i) => {
    const park = ctx.pricing.parks.find((p) => p.id === s.park_id)?.name ?? `Stop ${i + 1}`;
    if (!s.property_id) out.push(`${park}: choose a lodge.`);
    else if (!s.room_category_id) out.push(`${park}: choose a room.`);
    if (!(s.nights >= 1)) out.push(`${park}: at least 1 night.`);
  });
  if (plan.guest.rooms < 1) out.push("At least 1 room.");
  return out;
}
