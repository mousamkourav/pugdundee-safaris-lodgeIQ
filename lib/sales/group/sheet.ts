// The group costing sheet from the trip and Sales Master data (pure; tested in sheet.test.ts on the
// owner's real Master data). The same pricing engine as every quote is run on small "probe" groups,
// and each price line goes to its kind of cost on its day:
//   one guest in one room        -> the room lines = "single" (one room, one guest, a night)
//   two guests in one room       -> the room lines = "double"
//   a jeep's guests, 1 jeep each -> safaris, naturalists and per-jeep add-ons = "jeep"
//   a vehicle's people, 1 vehicle -> transfers and per-vehicle add-ons = "vehicle"
//   ten guests                   -> per-person and per-room add-ons / 10 = "person";
//                                   per-group add-ons = "group"
// Flights and items typed on the trip come from the trip itself: a flight's fare per person (or its
// price / the guests) = "person"; a city hotel's typed price = a room's price for the night (single
// and double, 8 Nov 2026: before, it was taken once for the whole group); any other typed price =
// "group". No offers, discounts, markup or adjustment in the sheet (the group's margin is set on the
// ladder). GST is in every figure.
import { planToTrip } from "@/lib/sales/plan/planner";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";
import type { PriceLine, PriceResult } from "@/lib/sales/pricing/types";
import { COST_KINDS, applyCells, type CostDay, type CostKind, type GroupSettings } from "./costing";

const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = (): Record<CostKind, number> => ({ single: 0, double: 0, jeep: 0, vehicle: 0, person: 0, group: 0 });

function probe(plan: Plan, ctx: BuilderContext, today: string, adults: number, rooms: number, extra: Partial<Plan> = {}): PriceResult {
  const p: Plan = {
    ...plan,
    guest: { ...plan.guest, adults, children: [], rooms },
    offer_ids: [],
    discount: null,
    markup_pct: 0,
    adjustment: null,
    gst: null,
    line_prices: {},
    ...extra,
  };
  return priceTrip(planToTrip(p, today), ctx.pricing);
}

export interface SheetBuild {
  days: Omit<CostDay, "cost" | "edited">[];
  missing: string[]; // prices Master data does not have (to type on Plan & price, or in the sheet)
}

export function buildCostSheet(plan: Plan, ctx: BuilderContext, today: string, g: Pick<GroupSettings, "per_jeep" | "per_vehicle">): SheetBuild {
  const keyOf = (i: number) => (plan.dateless ? `d${i + 1}` : plan.days[i].date);
  const idx = new Map(plan.days.map((d, i) => [d.date, i]));
  const auto = plan.days.map(() => zero());
  // what each figure is made of, said under it (8 Nov 2026: "2 safaris" on a day, not a puzzle)
  const parts = plan.days.map(() => ({}) as Partial<Record<CostKind, string[]>>);
  const note = (i: number, kind: CostKind, what: string) => (parts[i][kind] ??= []).push(what);
  const add = (line: PriceLine, kind: CostKind, factor = 1) => {
    const i = line.date ? idx.get(line.date) : undefined;
    if (i == null || line.missing) return;
    auto[i][kind] = r2(auto[i][kind] + line.amount * factor);
    note(i, kind, line.kind === "safari" ? (line.group === "naturalist" ? "naturalist" : "safari") : line.kind === "room" ? "room" : line.kind === "transfer" ? "transfer" : "add-on");
  };
  const unitOf = (l: PriceLine) => ctx.pricing.addons.find((a) => a.id === l.ref_id)?.pricing_unit ?? null;
  const isCustom = (l: PriceLine) => l.kind === "addon" && !l.ref_id;

  // rooms: one guest, then two guests, in one room
  for (const l of probe(plan, ctx, today, 1, 1).lines) if (l.kind === "room") add(l, "single");
  for (const l of probe(plan, ctx, today, 2, 1).lines) if (l.kind === "room") add(l, "double");

  // a jeep: its guests, one jeep on every safari
  const pj = Math.max(1, g.per_jeep);
  const jeepPlan: Partial<Plan> = {
    days: plan.days.map((d) => ({ ...d, safaris: d.safaris.map((s) => ({ ...s, jeeps: 1 })) })),
    stops: plan.stops.map((s) => ({ ...s, want_jeeps: undefined })),
  };
  for (const l of probe(plan, ctx, today, pj, Math.ceil(pj / 2), jeepPlan).lines) {
    if (l.kind === "safari") add(l, "jeep");
  }
  // a vehicle: its people, one vehicle on every transfer
  const pv = Math.max(1, g.per_vehicle);
  for (const l of probe(plan, ctx, today, pv, Math.ceil(pv / 2), { transfer_vehicles: 1, route_vehicles: {} }).lines) {
    if (l.kind === "transfer") add(l, "vehicle");
    else if (l.kind === "addon" && unitOf(l) === "per_vehicle") add(l, "vehicle");
  }
  // ten guests: per-person (and per-room, twin sharing) add-ons per guest; per-group add-ons
  const ten = probe(plan, ctx, today, 10, 5);
  for (const l of ten.lines) {
    if (l.kind !== "addon" || isCustom(l)) continue;
    const u = unitOf(l);
    if (u === "per_person" || u === "per_room") add(l, "person", 1 / 10);
    else if (u === "per_group") add(l, "group");
  }
  // flights and typed items from the trip itself
  const pax = Math.max(1, plan.guest.adults + plan.guest.children.length);
  plan.days.forEach((d, i) => {
    for (const it of d.items ?? []) {
      if (it.addon_id || it.car_package_id) continue;
      if (it.type === "flight") {
        const pp = it.flight?.fare_pp ?? (it.price != null ? it.price / pax : null);
        if (pp) {
          auto[i].person = r2(auto[i].person + pp);
          note(i, "person", "flight");
        }
      } else if (it.type === "hotel" && it.auto?.startsWith("hotel:") && it.price) {
        // a city hotel's price typed on the day plan: one room for the night (incl. tax)
        auto[i].single = r2(auto[i].single + it.price);
        auto[i].double = r2(auto[i].double + it.price);
        note(i, "single", "typed room price");
        note(i, "double", "typed room price");
      } else if (it.price) {
        auto[i].group = r2(auto[i].group + it.price);
        note(i, "group", "typed");
      }
    }
  });

  const name = (id: string | null | undefined) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const kind = (id: string | null | undefined) => ctx.properties.find((p) => p.id === id)?.kind ?? "";
  const roomName = (id: string | null | undefined) => ctx.rooms.find((r) => r.id === id)?.name ?? "";
  // a night at a city hotel typed by name (no Master data rates): its stay and its price from the trip
  const typedHotel = (i: number) => (plan.days[i].items ?? []).find((it) => it.type === "hotel" && it.auto?.startsWith("hotel:"));
  const say = (list: string[] | undefined) => {
    if (!list?.length) return undefined;
    const n = new Map<string, number>();
    for (const w of list) n.set(w, (n.get(w) ?? 0) + 1);
    const order = ["room", "typed room price", "safari", "naturalist", "transfer", "flight", "add-on", "typed"];
    return [...n]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([w, c]) => (c > 1 && w !== "typed room price" ? `${c} ${w}s` : w))
      .join(", ");
  };
  const days = plan.days.map((d, i) => {
    const pid = d.city_hotel?.property_id ?? d.property_id;
    const th = typedHotel(i);
    const stop = plan.stops.find((s) => s.property_id === d.property_id);
    const k = kind(pid);
    return {
      key: keyOf(i),
      n: i + 1,
      date: plan.dateless ? null : d.date,
      title: d.title,
      stay: pid ? name(pid) : th ? th.title.replace(/^Hotel:\s*/, "") : "",
      category: d.city_hotel ? roomName(d.city_hotel.room_category_id) : stop ? roomName(stop.room_category_id) : "",
      meal: d.city_hotel?.meal_plan ?? stop?.meal_plan ?? "",
      own_lodge: !!pid && (k || "own_lodge") === "own_lodge" && !d.city_hotel,
      city_hotel: !!d.city_hotel || k === "city_hotel" || !!th,
      auto: auto[i],
      why: Object.fromEntries(COST_KINDS.map((c) => [c, say(parts[i][c])]).filter(([, v]) => v)) as CostDay["why"],
    };
  });
  return { days, missing: [...new Set(ten.missing.map((m) => m.label))] };
}

// The sheet with the changes typed by hand.
export function costSheet(plan: Plan, ctx: BuilderContext, today: string, g: GroupSettings): { days: CostDay[]; missing: string[] } {
  const b = buildCostSheet(plan, ctx, today, g);
  return { days: applyCells(b.days, g.cells), missing: b.missing };
}

export { COST_KINDS };
