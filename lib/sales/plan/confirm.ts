// =====================================================================
// "Confirm the trip": the whole trip in plain words, in the order it happens, so the
// sales person checks what the reader (or the AI) understood before any price is shown.
// Every line can be corrected in one click (nights, lodge, room, remove, move). Plan &
// price opens, and a quote is saved for the guest, only once this route is confirmed
// (plan.confirmed.key = confirmKey(plan)); any later change to the route asks again.
// Pure, so it is tested without a database.
// =====================================================================

import { fmtDay } from "@/lib/sales/format";
import { mealLabel } from "@/lib/sales/pricing/engine";
import { itemStep, transferStep } from "./day-order";
import { lodgesInPark, mealPlansOf, roomsOf, routeKey, segments } from "./planner";
import { sanitizePlan } from "./sanitize";
import type { BuilderContext, Plan, PlanStop } from "./types";

// ---------------- the confirmation ----------------

// A short fingerprint of everything that makes the route (routeKey): FNV-1a, 32 bits.
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}-${s.length}`;
};
// the same value however it was built: keys sorted, empty keys left out
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
            .map((k) => [k, canon((v as Record<string, unknown>)[k])])
        )
      : v;

// The route as the server sees it (sanitizePlan), in one canonical form, so the browser and the
// server always agree: before (r1) the browser's plan was hashed as built, and a city stay built
// by the AI reading ({..., hotel, at}) hashed differently once the server rebuilt it ({..., at,
// hotel}): "The route changed after it was confirmed" on save, with nothing changed (2 Nov 2026).
export function confirmKey(plan: Plan): string {
  const clean = sanitizePlan(JSON.parse(JSON.stringify(plan))) ?? plan;
  return `r2-${fnv(JSON.stringify(canon(JSON.parse(routeKey(clean)))))}`;
}
// the key quotes confirmed before 2 Nov 2026 carry
const legacyKey = (plan: Plan) => `r1-${fnv(routeKey(plan))}`;

export const isConfirmed = (plan: Plan) => !!plan.confirmed && (plan.confirmed.key === confirmKey(plan) || plan.confirmed.key === legacyKey(plan));
export const markConfirmed = (plan: Plan, at: string): Plan => ({ ...plan, confirmed: { key: confirmKey(plan), at } });

// ---------------- the trip in plain words ----------------

export interface SummaryLine {
  kind: "guests" | "city" | "lodge" | "flight" | "transfer" | "note";
  date: string | null; // null: not tied to a day (the guests line)
  text: string;
  detail?: string; // second line: room, meal plan, safaris, experiences
  stop?: number; // a lodge line: index in plan.stops (editable)
  stay?: number; // a city line: index in plan.city_stays (editable)
  flight?: number; // a flight line: index in plan.flights (removable)
  warn?: boolean; // something to look at (no room chosen, a note from the planner)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function tripSummary(plan: Plan, ctx: BuilderContext): SummaryLine[] {
  const out: SummaryLine[] = [];
  const g = plan.guest;
  const segs = segments(plan);
  const nights = segs.reduce((t, s) => t + (s.kind === "city" ? s.stay.nights : s.stop.nights), 0);
  const start = segs[0]?.checkIn;
  const end = segs[segs.length - 1]?.checkOut;
  const when = plan.dateless ? "dates not fixed (priced by season)" : start && end ? `${fmtDay(start)} to ${fmtDay(end)}` : "";
  out.push({
    kind: "guests",
    date: null,
    text: `${plural(g.adults, "adult")}${g.children.length ? `, ${plural(g.children.length, "child", "children")} (${g.children.join(", ")})` : ""}, ${plural(g.rooms, "room")}, ${g.nationality === "indian" ? "Indian" : "foreign"} guests`,
    detail: `${plural(nights, "night")}${when ? `, ${when}` : ""}`,
  });

  const propName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const parkName = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? "";
  const locName = (id: string, label?: string) => label ?? ctx.locations.find((l) => l.id === id)?.name ?? id.replace(/^@/, "");
  const dayLabel = (d: string) => (plan.dateless ? `Day ${Math.round((Date.parse(d) - Date.parse(start ?? d)) / 86_400_000) + 1}` : fmtDay(d));

  // what happens on each date, in the order of the day (day-order.ts): leaving, flights,
  // arriving, then the stay that starts that day
  const byDate = new Map<string, { step: number; line: SummaryLine }[]>();
  const put = (date: string, step: number, line: SummaryLine) => byDate.set(date, [...(byDate.get(date) ?? []), { step, line }]);

  segs.forEach((s) => {
    if (s.kind === "city") {
      const c = s.stay;
      if (c.away) {
        put(s.checkIn, 3.5, {
          kind: "city",
          date: s.checkIn,
          stay: s.index,
          text: `Not with us: ${plural(c.nights, "night")} (own arrangements, not priced)`,
          detail: c.away_transfer === "ours" ? "Our car drops them at their hotel and picks them up (transfer prices typed on Plan & price)" : "They leave and rejoin on their own (no transfers)",
        });
        return;
      }
      const where = c.city || "A free day";
      const hotel = c.hotel ? ` at ${c.hotel}` : c.city ? ", hotel to be confirmed" : "";
      put(s.checkIn, 3.5, {
        kind: "city",
        date: s.checkIn,
        stay: s.index,
        text: `${where}: ${plural(c.nights, "night")}${hotel}`,
        detail: c.want_extras?.length ? `With ${c.want_extras.join(", ")}` : c.price ? `Rs ${c.price.toLocaleString("en-IN")} a night (typed)` : undefined,
      });
      return;
    }
    const st = s.stop;
    const room = ctx.rooms.find((r) => r.id === st.room_category_id)?.name;
    // the safaris of this stay, as the planner shares travel days: the evening of the day it
    // starts, the days in between, the morning of the day it leaves (all in its park)
    const days = plan.days.filter((d) => d.date >= s.checkIn && d.date <= s.checkOut);
    let safaris = 0;
    let naturalists = 0;
    const extras: string[] = [];
    for (const d of days) {
      for (const x of d.safaris) {
        const owned = d.date === s.checkIn ? x.session !== "morning" : d.date === s.checkOut ? x.session === "morning" : true;
        if (d.park_id !== st.park_id || !owned) continue;
        safaris++;
        if (x.naturalist) naturalists++;
      }
      if (d.date < s.checkOut) for (const it of d.items) if (it.type === "addon" || it.type === "activity") extras.push(it.title);
    }
    const parts = [
      room ? `${room}, ${mealLabel(st.meal_plan)}` : "no room chosen",
      safaris ? `${plural(safaris, "safari")}${naturalists ? ` (${naturalists === safaris ? "all" : naturalists} with a naturalist)` : ""}` : "no safaris",
      ...(extras.length ? [[...new Set(extras)].join(", ")] : []),
    ];
    put(s.checkIn, 3.5, {
      kind: "lodge",
      date: s.checkIn,
      stop: s.index,
      text: `${propName(st.property_id) || "No lodge chosen"} (${parkName(st.park_id)}): ${plural(st.nights, "night")}`,
      detail: parts.join("; "),
      warn: !st.property_id || !room,
    });
  });

  for (const d of plan.days) {
    const roads = [...(d.transfer ? [{ from: d.transfer.from_location_id, to: d.transfer.to_location_id, fromLabel: undefined as string | undefined, toLabel: undefined as string | undefined }] : []), ...(d.city_transfers ?? []).map((t) => ({ from: t.from_location_id, to: t.to_location_id, fromLabel: t.from_label, toLabel: t.to_label }))];
    for (const r of roads) {
      const a = locName(r.from, r.fromLabel);
      const b = locName(r.to, r.toLabel);
      put(d.date, transferStep(a, b), { kind: "transfer", date: d.date, text: `Transfer ${a} to ${b}${d.own_vehicle ? " (their own vehicle)" : ""}` });
    }
    for (const it of d.items) {
      if (it.type !== "flight") continue;
      const i = (plan.flights ?? []).findIndex((f) => it.flight && f.from === it.flight.from && f.to === it.flight.to);
      put(d.date, itemStep(it), { kind: "flight", date: d.date, text: `Flight ${it.flight?.from ?? ""} to ${it.flight?.to ?? ""}${it.flight?.time ? ` at ${it.flight.time}` : ""}`, ...(i >= 0 ? { flight: i } : {}) });
    }
    for (const n of d.notes) if (/no road|far apart|add the flight/i.test(n)) put(d.date, 0.5, { kind: "note", date: d.date, text: n, warn: true });
  }

  for (const date of [...byDate.keys()].sort()) {
    for (const { line } of byDate.get(date)!.sort((a, b) => a.step - b.step)) out.push({ ...line, text: `${dayLabel(date)} - ${line.text}` });
  }
  // flights the planner could not place on a day
  (plan.flights ?? []).forEach((f, i) => {
    if (!out.some((l) => l.flight === i)) out.push({ kind: "flight", date: null, flight: i, text: `Flight ${f.from} to ${f.to} (not placed on a day: check the city nights)`, warn: true });
  });
  return out;
}

// ---------------- one-click corrections ----------------

export type StopEdit = { nights: number } | { property_id: string } | { room_category_id: string } | "remove" | "up" | "down";

// A lodge line corrected. City nights keep their place between the same lodges.
export function editStop(plan: Plan, ctx: BuilderContext, i: number, edit: StopEdit): Plan {
  const stops = [...plan.stops];
  const s = stops[i];
  if (!s) return plan;
  if (edit === "remove") {
    stops.splice(i, 1);
    // nights between lodges count the lodges before them: one fewer after this one
    const stays = (plan.city_stays ?? []).map((c) => (c.at !== undefined && c.at > i ? { ...c, at: c.at - 1 } : c));
    return { ...plan, stops, city_stays: stays };
  }
  if (edit === "up" || edit === "down") {
    const j = edit === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= stops.length) return plan;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    return { ...plan, stops };
  }
  if ("nights" in edit) stops[i] = { ...s, nights: Math.max(1, Math.min(30, Math.round(edit.nights))) };
  else if ("property_id" in edit) {
    const lodge = lodgesInPark(ctx, s.park_id).find((l) => l.id === edit.property_id) ?? ctx.properties.find((l) => l.id === edit.property_id);
    if (!lodge) return plan;
    const room = roomsOf(ctx, lodge.id)[0];
    stops[i] = { ...s, park_id: lodge.park_id ?? s.park_id, property_id: lodge.id, room_category_id: room?.id ?? "", meal_plan: room ? mealPlansOf(ctx, room.id)[0] ?? s.meal_plan : s.meal_plan };
  } else if ("room_category_id" in edit) {
    const meals = mealPlansOf(ctx, edit.room_category_id);
    stops[i] = { ...s, room_category_id: edit.room_category_id, meal_plan: meals.includes(s.meal_plan) ? s.meal_plan : meals[0] ?? s.meal_plan } as PlanStop;
  }
  return { ...plan, stops };
}

export type StayEdit = { nights: number } | { away_transfer: "ours" | "own" } | "remove";

export function editStay(plan: Plan, k: number, edit: StayEdit): Plan {
  const stays = [...(plan.city_stays ?? [])];
  if (!stays[k]) return plan;
  if (edit === "remove") stays.splice(k, 1);
  else if ("away_transfer" in edit) stays[k] = { ...stays[k], away_transfer: edit.away_transfer };
  else stays[k] = { ...stays[k], nights: Math.max(1, Math.min(30, Math.round(edit.nights))) };
  // the trip date is the first lodge's day: city nights before it move the start, not the lodges
  return { ...plan, city_stays: stays };
}

export const removeFlight = (plan: Plan, i: number): Plan => ({ ...plan, flights: (plan.flights ?? []).filter((_, j) => j !== i) });

// The lodges a stop can change to (same park) and the rooms of its lodge, for the edit menus.
export function stopChoices(plan: Plan, ctx: BuilderContext, i: number) {
  const s = plan.stops[i];
  if (!s) return { lodges: [], rooms: [] };
  return {
    lodges: lodgesInPark(ctx, s.park_id).map((l) => ({ id: l.id, name: l.name })),
    rooms: roomsOf(ctx, s.property_id).map((r) => ({ id: r.id, name: r.name })),
  };
}
