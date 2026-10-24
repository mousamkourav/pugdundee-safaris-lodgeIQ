// Turns a route (parks + nights) into a day-by-day plan, and a plan into the
// TripInput the pricing engine needs. Pure functions; shared by the browser
// (live builder) and the server (save action).

import { addDays, dayName } from "@/lib/sales/pricing/dates";
import { closureFor } from "@/lib/sales/pricing/engine";
import type { ISODate, RateBasis, SafariInput, TransferInput, TripInput } from "@/lib/sales/pricing/types";
import type { BuilderContext, DaySafari, Plan, PlanDay, PlanItem, PlanStop } from "./types";

export const MEAL_ORDER = ["AP", "MAP", "CP", "EP"];

export function emptyPlan(today: ISODate): Plan {
  return {
    schema_version: 1,
    guest: { name: "", email: "", phone: "", phone_country: "IN", country: "", nationality: "foreign", adults: 2, children: [], rooms: 1, source: "", agent_name: "", notes: "" },
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
    manual_prices: {},
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

// Park closures on a date; none when the dates are not fixed yet (the weekday is unknown).
export const closedAt = (ctx: BuilderContext, plan: Pick<Plan, "dateless">, parkId: string, zone: string, session: string, date: ISODate) =>
  plan.dateless ? undefined : closureFor(ctx.pricing, parkId, zone, session, date);

// Morning + afternoon in the core zone; if the core is closed for a session,
// use the buffer zone when it has rates, otherwise drop that session.
export function autoSafaris(ctx: BuilderContext, parkId: string, date: ISODate, dateless = false): { safaris: DaySafari[]; notes: string[] } {
  // a city (Delhi, Agra...) or any place without safari rates: no safaris are planned there
  if (!ctx.pricing.safariRates.some((r) => r.park_id === parkId && r.active !== false)) return { safaris: [], notes: [] };
  const safaris: DaySafari[] = [];
  const notes: string[] = [];
  const closureFor = (_: unknown, park: string, zone: string, session: string, d: ISODate) => closedAt(ctx, { dateless }, park, zone, session, d);
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
      notes.push(`Core zone closed ${dayName(date)} ${session === "afternoon" ? "evening" : session}${why}; buffer can be used.`);
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

// Items added by hand survive a rebuild: same date, else same day number, else the last day.
// Items survive a rebuild. Hand-added ones keep their date (else day number, else
// the last day). Items the planner made from the guest's wishes (auto) are made
// again, but keep any edits (a flight's PNR, a price) if the same one existed.
function carryItems(oldDays: PlanDay[], days: PlanDay[]): PlanDay[] {
  if (!days.length) return days;
  const oldAuto = new Map<string, PlanItem>();
  for (const od of oldDays) for (const it of od.items ?? []) if (it.auto) oldAuto.set(it.auto, it);
  const out = days.map((d) => ({ ...d, items: (d.items ?? []).map((it) => (it.auto && oldAuto.has(it.auto) ? oldAuto.get(it.auto)! : it)) }));
  oldDays.forEach((od, i) => {
    const manual = (od.items ?? []).filter((it) => !it.auto);
    if (!manual.length) return;
    const target = out.find((d) => d.date === od.date) ?? out[i] ?? out[out.length - 1];
    target.items.push(...manual);
  });
  return out;
}

export function buildDays(plan: Plan, ctx: BuilderContext): PlanDay[] {
  const fresh = buildDaysFresh(plan, ctx).map((d) => ({ ...d, items: [] as PlanItem[] }));
  if (!fresh.length) return fresh;
  return carryItems(plan.days ?? [], addFlights(plan, addCityDays(plan, applyWants(plan, ctx, fresh))));
}

// The add-on at this lodge (else a general one) whose name has all the words, cheapest first.
export function findAddon(ctx: BuilderContext, propertyId: string, keyword: string, nationality?: "indian" | "foreign") {
  const words = keyword.toLowerCase().replace(/-/g, " ").split(/\s+/);
  const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const matches = ctx.pricing.addons.filter((a) => a.active !== false && !a.alias && words.every((w) => norm(a.name).includes(` ${w}`)));
  // Indian / foreign versions (boat safari at Denwa): the guest's nationality first, then the cheapest.
  const natScore = (name: string) => (!nationality || !/\((indian|foreign)/i.test(name) ? 1 : new RegExp(`\\(${nationality}`, "i").test(name) ? 0 : 2);
  const pick = (xs: typeof matches) => xs.sort((a, b) => natScore(a.name) - natScore(b.name) || a.rate - b.rate)[0];
  return (
    pick(matches.filter((a) => a.property_id === propertyId)) ??
    // a Pugdundee-wide experience, if this lodge offers it (or it is offered everywhere)
    pick(matches.filter((a) => !a.property_id && (!a.offered_at?.length || a.offered_at.includes(propertyId)))) ??
    null
  );
}

// A lodge's own experiences (only at that lodge): not meals, transfers, supplements,
// vehicles or naturalists. One of each Indian / foreign pair, by the guest's nationality.
const NOT_SPECIAL = /breakfast|lunch|dinner with|packed meal|meal|supplement|transfer|naturalist|modified|gate entry|full-day|maid|extra guest|each extra|accommodation|new year|to the lodge/i;
export function lodgeSpecials(ctx: BuilderContext, propertyId: string, nationality?: "indian" | "foreign") {
  const base = (n: string) => n.toLowerCase().replace(/\((indian|foreign)[^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const shared = new Set(ctx.pricing.addons.filter((a) => a.property_id && a.property_id !== propertyId).map((a) => base(a.name)));
  const own = ctx.pricing.addons.filter((a) => a.active !== false && !a.alias && a.property_id === propertyId && !NOT_SPECIAL.test(a.name) && !shared.has(base(a.name)));
  const byBase = new Map<string, (typeof own)[number]>();
  for (const a of own) {
    const k = base(a.name);
    const cur = byBase.get(k);
    const fits = (x: { name: string }) => !nationality || !/\((indian|foreign)/i.test(x.name) || new RegExp(`\\(${nationality}`, "i").test(x.name);
    if (!cur || (fits(a) && !fits(cur))) byBase.set(k, a);
  }
  return [...byBase.values()].slice(0, 3);
}

// Honour what the guest asked for at each stop: how many safaris, how many with a
// naturalist, and experiences (placed on the last evening at that lodge).
function applyWants(plan: Plan, ctx: BuilderContext, days: PlanDay[]): PlanDay[] {
  let start = 0;
  plan.stops.forEach((stop, k) => {
    const s0 = start; // this stop's arrival day
    const range = days.map((_, i) => i).filter((i) => i >= start && i <= start + stop.nights && days[i].park_id === stop.park_id);
    const lastNight = Math.min(days.length - 1, start + Math.max(0, stop.nights - 1));
    start += stop.nights;
    if (stop.want_safaris != null || stop.want_naturalists != null) {
      // On a day shared with the previous / next stop (moving lodges), this stop owns
      // the evening of its first day and the morning of its last day.
      // The arrival day is shared with the journey in (evening only); the moving-on day
      // with the next stop (morning only); the days in between are this stop's.
      const moveOut = s0 + stop.nights;
      const owns = (i: number, session: DaySafari["session"]) =>
        (i === s0 && session === "afternoon") || (i === moveOut && session === "morning") || (i > s0 && i < moveOut);
      // Short stays have no full day: if more safaris were asked for than planned, use the
      // evening of the arrival day and the morning before leaving (open times only).
      if (stop.want_safaris != null) {
        let planned = range.reduce((t, i) => t + days[i].safaris.filter((s) => owns(i, s.session)).length, 0);
        for (const x of [{ i: moveOut, session: "morning" as const }, { i: s0, session: "afternoon" as const }]) {
          if (planned >= stop.want_safaris) break;
          if (!range.includes(x.i)) continue; // a moving-on morning only when the next lodge is in the same park
          if (days[x.i].safaris.some((s) => s.session === x.session)) continue;
          const zone: DaySafari["zone"] | null = !closedAt(ctx, plan, stop.park_id, "core", x.session, days[x.i].date)
            ? "core"
            : !closedAt(ctx, plan, stop.park_id, "buffer", x.session, days[x.i].date)
              ? "buffer"
              : null;
          if (!zone) continue;
          const safaris = [...days[x.i].safaris, { session: x.session, zone }].sort((a, b) => (a.session === "morning" ? 0 : 1) - (b.session === "morning" ? 0 : 1));
          days[x.i] = {
            ...days[x.i],
            safaris,
            notes: [...days[x.i].notes, `${x.session === "afternoon" ? "Evening" : "Morning"} safari on a travel day, to fit the ${stop.want_safaris} safari${stop.want_safaris === 1 ? "" : "s"} asked for.`],
          };
          planned++;
        }
      }
      const slots = range.flatMap((i) => days[i].safaris.filter((s) => owns(i, s.session)).map((s) => ({ i, session: s.session })));
      const keep = stop.want_safaris != null ? slots.slice(0, Math.max(0, stop.want_safaris)) : slots;
      const nat = stop.want_naturalists == null ? 0 : stop.want_naturalists < 0 ? keep.length : Math.min(stop.want_naturalists, keep.length);
      for (const i of range) {
        const safaris = days[i].safaris
          .filter((s) => !owns(i, s.session) || keep.some((x) => x.i === i && x.session === s.session))
          .map((s) => (owns(i, s.session) ? { ...s, naturalist: keep.findIndex((x) => x.i === i && x.session === s.session) < nat } : s));
        const kind = days[i].kind === "safari" && !safaris.length ? "leisure" : days[i].kind;
        days[i] = describe(ctx, { ...days[i], safaris, kind }, plan.vehicle_type);
      }
      if (stop.want_safaris != null && stop.want_safaris > slots.length && range.length) {
        const park = ctx.pricing.parks.find((p) => p.id === stop.park_id)?.name ?? "the park";
        days[range[0]].notes = [...days[range[0]].notes, `${stop.want_safaris} safaris were asked for in ${park}, but only ${slots.length} fit in ${stop.nights} night${stop.nights === 1 ? "" : "s"}.`];
      }
    }
    const specials = (stop.want_extras ?? []).includes("special") ? lodgeSpecials(ctx, stop.property_id, plan.guest.nationality) : [];
    const usedIds = new Set<string>();
    for (const kw of stop.want_extras ?? []) {
      if (kw === "special") continue;
      const found = findAddon(ctx, stop.property_id, kw, plan.guest.nationality);
      if (found) usedIds.add(found.id);
    }
    for (const sp of specials) {
      if (usedIds.has(sp.id)) continue;
      const item: PlanItem = { id: `auto-${k}-sp-${sp.id}`, type: "addon", title: sp.name, detail: "", price: null, addon_id: sp.id, qty: null, auto: `extra:${k}:special:${sp.id}` };
      days[lastNight] = { ...days[lastNight], items: [...days[lastNight].items, item] };
    }
    for (const kw of stop.want_extras ?? []) {
      if (kw === "special") continue;
      const addon = findAddon(ctx, stop.property_id, kw, plan.guest.nationality);
      const item: PlanItem = addon
        ? { id: `auto-${k}-${kw}`, type: "addon", title: addon.name, detail: "", price: null, addon_id: addon.id, qty: null, auto: `extra:${k}:${kw}` }
        : { id: `auto-${k}-${kw}`, type: "activity", title: kw.replace(/\b\w/g, (c) => c.toUpperCase()), detail: "", price: null, addon_id: null, qty: null, auto: `extra:${k}:${kw}` };
      days[lastNight] = { ...days[lastNight], items: [...days[lastNight].items, item] };
    }
  });
  return days;
}

const cityDay = (date: string, title: string, text: string): PlanDay => ({
  date,
  kind: "city",
  property_id: null,
  park_id: null,
  safaris: [],
  transfer: null,
  title,
  text,
  notes: [],
  items: [],
});

// Nights in a city outside our lodges, before the first lodge and after the last.
// With a hotel price, each night carries a priced "hotel" item.
function addCityDays(plan: Plan, days: PlanDay[]): PlanDay[] {
  const before = (plan.city_stays ?? []).find((c) => c.when === "before" && c.nights > 0);
  const after = (plan.city_stays ?? []).find((c) => c.when === "after" && c.nights > 0);
  const where = (c: { city: string; hotel?: string }) => (c.hotel ? `${c.hotel}, ${c.city}` : `${c.city}; hotel to be confirmed`);
  const night = (c: { when: string; city: string; hotel?: string; price?: number | null }, j: number): PlanItem[] =>
    c.price
      ? [{ id: `auto-hotel-${c.when}-${j}`, type: "hotel", title: `Hotel: ${c.hotel || c.city}`, detail: "", price: c.price, addon_id: null, qty: null, auto: `hotel:${c.when}:${j}` }]
      : [];
  let out = [...days];
  if (before) {
    const pre = Array.from({ length: before.nights }, (_, j) => {
      const d =
        j === 0
          ? cityDay(addDays(days[0].date, -before.nights), `Arrive in ${before.city}`, `Arrive in ${before.city}. Overnight at ${where(before)}.`)
          : cityDay(addDays(days[0].date, -before.nights + j), before.city, `A day in ${before.city}. Overnight at ${where(before)}.`);
      return { ...d, items: night(before, j) };
    });
    out = [...pre, ...out];
  }
  if (after) {
    const last = out[out.length - 1];
    out[out.length - 1] = { ...last, text: `${last.text} Overnight at ${where(after)}.`.trim(), items: [...last.items, ...night(after, 0)] };
    for (let j = 1; j <= after.nights; j++) {
      out.push(
        j < after.nights
          ? { ...cityDay(addDays(last.date, j), after.city, `A day in ${after.city}. Overnight at ${where(after)}.`), items: night(after, j) }
          : cityDay(addDays(last.date, j), `Depart from ${after.city}`, "Transfer to the airport for your onward journey.")
      );
    }
  }
  return out;
}

// Flights go on the day they are taken: into the first lodge's day, or out on the last lodge day.
function addFlights(plan: Plan, days: PlanDay[]): PlanDay[] {
  const flights = plan.flights ?? [];
  if (!flights.length) return days;
  const firstLodge = days.findIndex((d) => d.kind !== "city");
  const lastLodge = days.length - 1 - [...days].reverse().findIndex((d) => d.kind !== "city");
  const before = (plan.city_stays ?? []).find((c) => c.when === "before");
  const after = (plan.city_stays ?? []).find((c) => c.when === "after");
  const out = [...days];
  flights.forEach((f, i) => {
    const inbound = (before && f.from === before.city) || (!(after && f.to === after.city) && i === 0);
    const at = inbound ? firstLodge : lastLodge;
    if (at < 0) return;
    const item: PlanItem = {
      id: `auto-flight-${i}`,
      type: "flight",
      title: `Flight ${f.from} to ${f.to}`,
      detail: "",
      price: null,
      addon_id: null,
      qty: null,
      flight: { from: f.from, to: f.to, airline: "", number: "", time: f.time ?? "", pnr: "" },
      auto: `flight:${i}:${f.from}>${f.to}`,
    };
    out[at] = { ...out[at], items: [...out[at].items, item] };
  });
  return out;
}

function buildDaysFresh(plan: Plan, ctx: BuilderContext): PlanDay[] {
  const days: PlanDay[] = [];
  const legs = stopDates(plan);
  const vehicle = plan.vehicle_type;

  legs.forEach(({ stop, checkIn }, i) => {
    const toLoc = locationOfProperty(ctx, stop.property_id);
    const fromLoc = i === 0 ? plan.arrival_location_id : locationOfProperty(ctx, legs[i - 1].stop.property_id);
    // Moving between two lodges in the same park (Tree House Hideaway to Kings Lodge):
    // a morning safari first, then the short drive.
    const samePark = i > 0 && legs[i - 1].stop.park_id === stop.park_id;
    const morning = samePark ? autoSafaris(ctx, stop.park_id, checkIn, plan.dateless).safaris.filter((x) => x.session === "morning") : [];
    days.push(
      describe(ctx, {
        date: checkIn,
        kind: i === 0 ? "arrival" : "transfer",
        property_id: stop.property_id,
        park_id: stop.park_id,
        safaris: morning,
        transfer: fromLoc && toLoc ? { from_location_id: fromLoc, to_location_id: toLoc } : null,
        title: "",
        text: "",
        notes: [],
        items: [],
      }, vehicle)
    );
    for (let n = 1; n < stop.nights; n++) {
      const date = addDays(checkIn, n);
      const { safaris, notes } = autoSafaris(ctx, stop.park_id, date, plan.dateless);
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
          items: [],
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
        items: [],
      }, vehicle)
    );
  }
  return days;
}

// ---------------- titles and text ----------------

// Approximate drive time between two places: the same road either way, the chosen
// vehicle first, else any vehicle that has a time for that road.
export function driveHours(ctx: BuilderContext, from: string, to: string, vehicle: string | null) {
  const road = ctx.pricing.transferRates.filter(
    (t) => t.drive_hours != null && ((t.from_location_id === from && t.to_location_id === to) || (t.from_location_id === to && t.to_location_id === from))
  );
  const r = road.find((t) => vehicle && t.vehicle_type === vehicle) ?? road[0];
  return r?.drive_hours ?? null;
}

const DEFAULT_TEXT: Record<PlanDay["kind"], string> = {
  arrival: "Arrive at {from} and drive to {lodge}{hours}. Evening at leisure.",
  transfer: "After breakfast, drive to {lodge} in {park}{hours}. Evening at leisure.",
  safari: "{safaris} in {park}.",
  leisure: "A day at leisure at {lodge}.",
  departure: "After breakfast, drive to {to}{hours} for your onward journey.",
  city: "",
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

const sessionWord = (x: DaySafari) => (x.session === "full_day" ? "Full-day" : x.session === "morning" ? "Morning" : "Evening");

function safariPhrase(s: DaySafari[]) {
  if (!s.length) return "No safaris";
  const sessions = s.length === 2 ? "Morning and evening jeep safaris" : `${sessionWord(s[0])} jeep safari`;
  const zones = [...new Set(s.map((x) => x.zone))];
  return `${sessions} (${zones.join(" and ")} zone)`;
}

// One safari on a travel day, as a sentence: "Early morning jeep safari in Bandhavgarh (core zone), with a naturalist."
function travelDaySafari(x: DaySafari, park: string) {
  const when = x.session === "morning" ? "Early morning jeep safari" : x.session === "afternoon" ? "Evening jeep safari" : "Full-day jeep safari";
  return `${when}${park ? ` in ${park}` : ""} (${x.zone} zone)${x.naturalist ? ", accompanied by a naturalist" : ""}.`;
}

export function describe(ctx: BuilderContext, day: PlanDay, vehicle: string | null): PlanDay {
  if (day.kind === "city") return day; // written when the city day is made
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
    city: day.title,
  };

  const template = pickTemplate(ctx, day.kind, day.park_id, day.property_id)?.body ?? DEFAULT_TEXT[day.kind];
  const text = template
    .replaceAll("{lodge}", lodge)
    .replaceAll("{park}", park)
    .replaceAll("{from}", from || "the airport")
    .replaceAll("{to}", to || "your onward point")
    .replaceAll("{hours}", hours)
    .replaceAll("{safaris}", safariPhrase(day.safaris))
    .replace(/,? with a resident naturalist/gi, "")
    .replace(/resident naturalists?/gi, (m) => (m.toLowerCase().endsWith("s") ? "naturalists" : "naturalist"));
  // Safari days: one sentence about the naturalist. Travel days (arrival, moving
  // lodges, departure): each safari is written into the text where it happens,
  // so the text never mentions a naturalist without the safari.
  if (day.kind === "safari" || day.kind === "leisure") {
    const nat = day.safaris.filter((s) => s.naturalist).length;
    const withNat =
      nat === 0
        ? ""
        : nat === day.safaris.length
          ? nat === 1
            ? " Accompanied by a naturalist."
            : " Each safari is accompanied by a naturalist."
          : ` A naturalist accompanies the ${sessionWord(day.safaris.find((s) => s.naturalist)!).toLowerCase()} safari.`;
    return { ...day, title: titles[day.kind], text: text + (day.park_id && day.safaris.length ? withNat : "") };
  }
  let travel = text;
  const early = day.safaris.filter((x) => x.session !== "afternoon");
  const late = day.safaris.filter((x) => x.session === "afternoon");
  if (early.length) {
    // a morning safari on the day of check-out: safari, then breakfast and check-out, then the drive
    const safariText = early.map((x) => travelDaySafari(x, park)).join(" ");
    const rest = travel.replace(/^\s*after breakfast,\s*/i, "");
    travel =
      rest !== travel
        ? `${safariText} Back at the lodge for breakfast and check-out, then ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`
        : `${safariText} ${travel}`;
  }
  if (late.length) {
    const evening = late.map((x) => travelDaySafari(x, park)).join(" ");
    travel = /evening at leisure\.?/i.test(travel) ? travel.replace(/evening at leisure\.?/i, evening) : `${travel} ${evening}`;
  }
  return { ...day, title: titles[day.kind], text: travel.trim() };
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
  const addons: { addon_id: string; date: string; qty?: number }[] = [];
  const custom: { date: string; title: string; amount: number; group?: "flight" | "extra" | "hotel" }[] = [];
  const flightPax = plan.guest.adults + plan.guest.children.length;
  for (const d of plan.days) {
    if (d.park_id) for (const s of d.safaris) safaris.push({ date: d.date, park_id: d.park_id, zone: s.zone, session: s.session, naturalist: !!s.naturalist, ...(s.jeeps ? { vehicles: s.jeeps } : {}) });
    if (d.transfer) transfers.push({ date: d.date, ...d.transfer, vehicle_type: plan.vehicle_type ?? undefined });
    for (const it of d.items ?? []) {
      if (it.addon_id) addons.push({ addon_id: it.addon_id, date: d.date, qty: it.qty ?? undefined });
      else {
        // a flight with a fare per person follows the number of guests
        const amount = it.type === "flight" && it.flight?.fare_pp ? it.flight.fare_pp * flightPax : it.price;
        if (amount) custom.push({ date: d.date, title: it.title, amount, group: it.type === "flight" ? "flight" : it.type === "hotel" ? "hotel" : "extra" });
      }
    }
  }
  return {
    adults: plan.guest.adults,
    children: plan.guest.children,
    nationality: plan.guest.nationality,
    stays,
    safaris,
    transfers,
    addons,
    custom_items: custom,
    manual_prices: plan.manual_prices ?? {},
    discount: plan.discount && plan.discount.pct > 0 ? plan.discount : null,
    offer_ids: plan.offer_ids,
    markup_pct: plan.markup_pct,
    adjustment: plan.adjustment,
    currency: plan.currency,
    booking_date: bookingDate,
    rate_basis: plan.dateless ? plan.rate_basis ?? DEFAULT_BASIS : null,
    fx_rate: plan.fx_rate ?? null,
    gst: plan.gst ?? null,
    line_prices: plan.line_prices ?? {},
  };
}

export const DEFAULT_BASIS: RateBasis = { season: "high", safari_days: "weekday", year: "current" };

// Everything that changes the day plan. If this changes, the days are rebuilt.
export const routeKey = (p: Plan) =>
  JSON.stringify([p.arrival_date, p.arrival_location_id, p.departure_location_id, p.stops, p.vehicle_type, p.guest.rooms, p.city_stays ?? [], p.flights ?? [], !!p.dateless]);

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

// Vehicles with transfer rates at every lodge that has any transfers (so the choice
// works on any route); Innova first. A vehicle only one lodge has is not offered.
export function commonVehicles(ctx: BuilderContext): string[] {
  const lodgeOfLoc = new Map(ctx.locations.filter((l) => l.property_id).map((l) => [l.id, l.property_id!]));
  const byLodge = new Map<string, Set<string>>();
  for (const r of ctx.pricing.transferRates) {
    if (r.active === false) continue;
    for (const loc of [r.from_location_id, r.to_location_id]) {
      const lodge = lodgeOfLoc.get(loc);
      if (!lodge) continue;
      if (!byLodge.has(lodge)) byLodge.set(lodge, new Set());
      byLodge.get(lodge)!.add(r.vehicle_type);
    }
  }
  const sets = [...byLodge.values()];
  if (!sets.length) return [];
  const common = [...sets[0]].filter((v) => sets.every((s) => s.has(v)));
  return common.sort((a, b) => Number(!/innova/i.test(a)) - Number(!/innova/i.test(b)) || a.localeCompare(b));
}

// Rooms after the number of adults changes: more than 3 adults in a room (2 + an
// extra bed) needs more rooms, so add enough for 2 per room; otherwise keep the choice.
export const roomsFor = (adults: number, rooms: number) => (adults > rooms * 3 ? Math.ceil(adults / 2) : rooms);

// New itineraries start with the Innova (or the first common vehicle).
export const defaultVehicle = (ctx: BuilderContext) => commonVehicles(ctx)[0] ?? null;
