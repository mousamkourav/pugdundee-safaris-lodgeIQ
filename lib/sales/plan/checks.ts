// =====================================================================
// Hard checks before a quote is saved for the guest, whatever the reader made of the
// enquiry. Each problem is a plain sentence saying what to fix and where; saving for the
// guest is blocked (in the browser and again on the server) until there are none.
//   - the trip was confirmed in plain words for this route (Confirm step)
//   - every stop has a lodge, a room, a meal plan and nights; city nights at least 1
//   - the days run on without a gap or a repeat, from the first night to the last morning
//   - no road transfer between two road regions (that is a flight)
//   - every lodge has a way in and a way out (a transfer, or their own vehicle)
//   - every price comes from Master data or was typed
// Pure, so it is tested without a database.
// =====================================================================

import { fmtDay } from "@/lib/sales/format";
import { addDays } from "@/lib/sales/pricing/dates";
import type { PriceResult } from "@/lib/sales/pricing/types";
import { isConfirmed } from "./confirm";
import { noRoad, roadRegions, routeProblems, segments } from "./planner";
import type { BuilderContext, Plan } from "./types";

export function quoteChecks(plan: Plan, ctx: BuilderContext, result: PriceResult | null): string[] {
  const out: string[] = [];
  const lodge = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? "A lodge";
  const place = (id: string, label?: string) => label ?? ctx.locations.find((l) => l.id === id)?.name ?? id.replace(/^@/, "");

  // ---- the stops
  if (!plan.stops.length) return ["Add at least one park."];
  out.push(...routeProblems(plan, ctx));
  for (const s of plan.stops) if (s.property_id && s.room_category_id && !s.meal_plan) out.push(`${lodge(s.property_id)}: choose a meal plan.`);
  for (const c of plan.city_stays ?? []) if (!(c.nights >= 1)) out.push(`${c.city || "An added day"}: at least 1 night.`);
  if (out.length) return out; // the rest needs a complete route

  if (!isConfirmed(plan)) {
    out.push(plan.confirmed ? "The route changed after it was confirmed: check it again on the Confirm step." : "Confirm the trip first (Confirm step: \"Correct, continue\").");
  }
  if (!plan.days.length) return [...out, "Build the day plan first."];

  // ---- the days run on: one day per date, from the first night to the last morning
  const segs = segments(plan);
  const start = segs[0].checkIn;
  const end = segs[segs.length - 1].checkOut;
  const dates = plan.days.map((d) => d.date);
  // dates not fixed: the placeholder date is never shown, the day of the trip is ("Day 3")
  const day1 = dates[0] && dates[0] < start ? dates[0] : start;
  const when = (d: string) => (plan.dateless ? `Day ${Math.round((Date.parse(d) - Date.parse(day1)) / 86_400_000) + 1}` : fmtDay(d));
  if (dates[0] !== start || dates[dates.length - 1] !== end) {
    out.push(`The day plan runs ${when(dates[0])} to ${when(dates[dates.length - 1])}, but the trip runs ${when(start)} to ${when(end)}. Update the day plan.`);
  } else {
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] === dates[i - 1]) out.push(`${when(dates[i])} is in the day plan twice.`);
      else if (dates[i] !== addDays(dates[i - 1], 1)) out.push(`No day in the plan for ${when(addDays(dates[i - 1], 1))}: the days are not continuous.`);
    }
  }

  // ---- every road, as planned day by day
  const regions = roadRegions(ctx);
  type Road = { from: string; to: string; own: boolean; fromLabel?: string; toLabel?: string };
  const roadsOf = (d: Plan["days"][number]): Road[] => [
    ...(d.transfer ? [{ from: d.transfer.from_location_id, to: d.transfer.to_location_id, own: !!d.own_vehicle }] : []),
    ...(d.city_transfers ?? []).map((t) => ({ from: t.from_location_id, to: t.to_location_id, own: !!d.own_vehicle, fromLabel: t.from_label, toLabel: t.to_label })),
  ];
  const roadsOn = (date: string) => plan.days.filter((d) => d.date === date).flatMap(roadsOf);
  for (const d of plan.days) {
    for (const r of roadsOf(d)) {
      if (noRoad(ctx, r.from, r.to, regions)) {
        out.push(`${when(d.date)}: a road transfer ${place(r.from, r.fromLabel)} to ${place(r.to, r.toLabel)} joins two regions with no road between them. Add the flight instead.`);
      }
    }
  }

  // ---- two cities with no road and no flight between them (Siliguri to Delhi): the day says so
  for (const d of plan.days) for (const n of d.notes) if (/^No road between /.test(n)) out.push(`${when(d.date)}: ${n}`);

  // ---- a way in and a way out for every lodge (a transfer, or their own vehicle)
  const lodges = segs.filter((s) => s.kind === "lodge");
  // next to nights not with us (own arrangements): they leave / rejoin on their own unless our car is set
  const awayOwn = (seg: (typeof segs)[number] | undefined) => seg?.kind === "city" && !!seg.stay.away && seg.stay.away_transfer !== "ours";
  lodges.forEach((s, n) => {
    if (s.kind !== "lodge") return;
    const at = segs.indexOf(s);
    const loc = ctx.locations.find((l) => l.property_id === s.stop.property_id)?.id;
    if (!loc || plan.own_vehicle) return;
    const first = n === 0;
    const last = n === lodges.length - 1;
    const ownIn = (first ? plan.arrival_mode === "own" : plan.between_lodges === "own") || roadsOn(s.checkIn).some((r) => r.own) || awayOwn(segs[at - 1]);
    const ownOut = (last ? plan.departure_mode === "own" : plan.between_lodges === "own") || roadsOn(s.checkOut).some((r) => r.own) || awayOwn(segs[at + 1]);
    if (!ownIn && !roadsOn(s.checkIn).some((r) => r.to === loc)) {
      out.push(`${lodge(s.stop.property_id)}: no way in on ${when(s.checkIn)}. Set where our car picks them up (Trip step: arrival point), add the flight before it, or mark their own vehicle.`);
    }
    if (!ownOut && !roadsOn(s.checkOut).some((r) => r.from === loc)) {
      out.push(`${lodge(s.stop.property_id)}: no way out on ${when(s.checkOut)}. Set where they leave from (Trip step: departure point), add the flight after it, or mark their own vehicle.`);
    }
  });

  // ---- every price from Master data or typed
  if (!result) out.push("The trip could not be priced. Check the route and the dates.");
  else {
    out.push(...result.errors);
    // every line without a rate is in the missing list (the engine records each one)
    for (const m of result.missing) if (plan.manual_prices?.[m.key] === undefined) out.push(`Price needed: ${m.label} (${m.unit}). Type it on Plan & price.`);
  }
  return [...new Set(out)];
}
