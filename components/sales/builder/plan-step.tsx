"use client";

import { useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { dayName } from "@/lib/sales/pricing/dates";
import { closedAt, describe, routeOf, roomsFor, segments, stayAt } from "@/lib/sales/plan/planner";
import { cityParkIds, sameCity } from "@/lib/sales/plan/cities";
import { detailedBreakdown } from "@/lib/sales/pricing/breakdown";
import { FLIGHT_BAGGAGE } from "@/lib/sales/plan/draft";
import type { PriceResult } from "@/lib/sales/pricing/types";
import type { BuilderContext, CityStay, DaySafari, Plan, PlanDay, PlanItem } from "@/lib/sales/plan/types";

type SetPlan = (u: (p: Plan) => Plan) => void;
const DRAG_TYPE = "application/x-lodgeiq-item";

const TYPE_LABEL: Record<PlanItem["type"], string> = {
  addon: "Add-on",
  activity: "Activity",
  hotel: "Hotel / stay",
  transfer: "Transfer",
  meal: "Meal",
  note: "Note",
  flight: "Flight",
};
const TYPE_ICON: Record<PlanItem["type"], string> = { addon: "plus", activity: "route", hotel: "building", transfer: "car", meal: "wine", note: "fileText", flight: "send" };
// Airports people fly in and out of for these parks (suggestions; anything can be typed).
const AIRPORTS = ["Delhi", "Mumbai", "Bengaluru", "Kolkata", "Jabalpur", "Nagpur", "Bhopal", "Raipur", "Khajuraho", "Bagdogra", "Indore", "Varanasi"];
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function flightSummary(f?: PlanItem["flight"]) {
  if (!f) return "";
  return [f.airline && f.number ? `${f.airline} ${f.number}` : f.airline || f.number, f.time && `departs ${f.time}${f.arrive ? `, lands ${f.arrive}` : ""}`, f.pnr && `PNR ${f.pnr}`, f.fare_pp && `Rs ${f.fare_pp.toLocaleString("en-IN")} per person`]
    .filter(Boolean)
    .join(" \u00b7 ");
}

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD"] as const;

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

type DragData = { kind: "new"; item: Omit<PlanItem, "id">; group?: string } | { kind: "move"; id: string; from: number };

export function PlanStep({
  plan,
  setPlan,
  ctx,
  result,
}: {
  plan: Plan;
  setPlan: SetPlan;
  ctx: BuilderContext;
  result: PriceResult | null;
}) {
  const [targetDay, setTargetDay] = useState(0);
  const [overDay, setOverDay] = useState<number | null>(null);
  const [tab, setTab] = useState<"addons" | "custom">(ctx.pricing.addons.length ? "addons" : "custom");
  const [custom, setCustom] = useState<{ type: PlanItem["type"]; title: string; detail: string; price: string }>({ type: "activity", title: "", detail: "", price: "" });
  const [flight, setFlight] = useState({ from: "", to: "", airline: "", number: "", time: "", arrive: "", pnr: "", fare: "", cabin: "Economy", baggage: FLIGHT_BAGGAGE, route_id: "" });
  // Master data > Flight routes matching what is typed in From / To (all when both are empty)
  const routes = (ctx.flightRoutes ?? []).filter(
    (r) =>
      (!flight.from.trim() || r.from_city.toLowerCase().startsWith(flight.from.trim().toLowerCase())) &&
      (!flight.to.trim() || r.to_city.toLowerCase().startsWith(flight.to.trim().toLowerCase()))
  );
  const [childrenText, setChildrenText] = useState(plan.guest.children.join(", "));
  const guests = plan.guest.adults + plan.guest.children.length;
  const autoJeeps = Math.max(1, Math.ceil(guests / 6));
  const closed = (park: string, zone: string, session: string, date: string) => !!closedAt(ctx, plan, park, zone, session, date);
  const [search, setSearch] = useState("");

  const lodgeName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const locName = (id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "?";
  // ---- city stays and added days
  const stays = plan.city_stays ?? [];
  const stayOf = (d: PlanDay) => (d.stay_index !== undefined ? stays[d.stay_index] : undefined);
  const setStays = (fn: (s: CityStay[]) => CityStay[]) => setPlan((p) => ({ ...p, city_stays: fn(p.city_stays ?? []) }));
  const updateStay = (k: number, patch: Partial<CityStay>) => setStays((s) => s.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const removeStay = (k: number) => setStays((s) => s.filter((_, j) => j !== k));
  const [addMenu, setAddMenu] = useState<number | null>(null);
  // the lodge stay a day belongs to (a night there)
  const lodgeSegOf = (d: PlanDay) => segments(plan).find((s) => s.kind === "lodge" && d.date >= s.checkIn && d.date < s.checkOut) as
    | Extract<ReturnType<typeof segments>[number], { kind: "lodge" }>
    | undefined;
  // "Add a day" after day i: one more night where the guests are, or a blank day after this stay
  function addDayAfter(i: number, mode: "night" | "blank") {
    setAddMenu(null);
    const d = plan.days[i];
    const n = plan.stops.length;
    const blank = (at: number): CityStay => ({ when: at === 0 ? "before" : "after", city: "", nights: 1, blank: true, ...(at < n ? { at } : {}) });
    if (d.stay_index !== undefined && stays[d.stay_index]) {
      const k = d.stay_index;
      if (mode === "night") return updateStay(k, { nights: Math.min(14, stays[k].nights + 1) });
      const b = blank(stayAt(stays[k], n));
      return setStays((s) => [...s.slice(0, k + 1), b, ...s.slice(k + 1)]);
    }
    const seg = lodgeSegOf(d);
    if (seg) {
      if (mode === "night") return setPlan((p) => ({ ...p, stops: p.stops.map((st, j) => (j === seg.index ? { ...st, nights: Math.min(60, st.nights + 1) } : st)) }));
      const at = seg.index + 1;
      const pos = stays.findIndex((c) => stayAt(c, n) >= at);
      const b = blank(at);
      return setStays((s) => (pos < 0 ? [...s, b] : [...s.slice(0, pos), b, ...s.slice(pos)]));
    }
    // the last day: a blank day at the end
    setStays((s) => [...s, { when: "after", city: "", nights: 1, blank: true }]);
  }
  // vehicles on one road: typed here, else the trip's, else enough for the group; 0 = not needed
  const transferLine = (date: string, a: string, b: string) =>
    result?.lines.find((l) => l.kind === "transfer" && l.date === date && (l.description === `${a} to ${b}` || l.description.startsWith(`${a} to ${b} by`)));
  const setRouteVehicles = (key: string, v: number | null) =>
    setPlan((p) => {
      const rv = { ...(p.route_vehicles ?? {}) };
      if (v === null) delete rv[key];
      else rv[key] = v;
      return { ...p, route_vehicles: rv };
    });
  const vehiclesBox = (from: string, to: string, date: string, a: string, b: string) => {
    const key = routeOf(from, to);
    const set = plan.route_vehicles?.[key];
    const line = transferLine(date, a, b);
    if (plan.own_vehicle) return <span className="shrink-0 text-[11px] italic text-sand-400">own vehicle</span>;
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-sand-500">
        {set === 0 ? <span className="italic">not needed</span> : line && !line.missing ? <span className="tabular text-xs text-sand-600">{rupees(line.amount)}</span> : null}
        <label className="flex items-center gap-1" title="Vehicles on this transfer. Empty = automatic; 0 = not needed (the guests make their own way)">
          Vehicles
          <input
            type="number"
            min={0}
            max={20}
            placeholder={line && !line.missing ? String(line.quantity) : "auto"}
            className="tabular w-12 rounded border border-sand-200 px-1.5 py-0.5 text-right text-xs"
            value={set ?? ""}
            onChange={(e) => setRouteVehicles(key, e.target.value === "" ? null : Math.max(0, Math.min(20, Math.round(Number(e.target.value)))))}
            aria-label={`Vehicles from ${a} to ${b}`}
          />
        </label>
      </span>
    );
  };
  const missingKeys = new Set((result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined).map((m) => m.key));
  // the trip's lodges, and the city hotels it stays at (Roseate House): their own add-ons are offered
  const hotelIdOf = (name?: string) => ctx.properties.find((p) => p.name.toLowerCase() === (name ?? "").trim().toLowerCase())?.id;
  const cityHotelIds = [...plan.days.map((d) => d.city_hotel?.property_id), ...(plan.city_stays ?? []).map((c) => hotelIdOf(c.hotel))].filter((x): x is string => !!x);
  const parkLodges = new Set([...plan.stops.map((s) => s.property_id), ...cityHotelIds]);
  // Experiences: the same one at several lodges (bush dinner, nature walk, cycling) is a
  // Pugdundee experience and shown once; one that exists at a single lodge is labelled
  // with it. Naturalists are a tick on each safari, so they are not listed here.
  // City extras (Delhi sightseeing): add-ons with the city as their park, offered when the trip has nights there
  const cityParks = cityParkIds(ctx);
  const cityOfAddon = (a: (typeof ctx.pricing.addons)[number]) => (a.park_id && cityParks.has(a.park_id) ? ctx.pricing.parks.find((p) => p.id === a.park_id)?.name ?? null : null);
  const tripCities = stays.map((c) => c.city).filter(Boolean);
  const addonGroups = (() => {
    const byName = new Map<string, typeof ctx.pricing.addons>();
    for (const a of ctx.pricing.addons) {
      if (a.active === false || a.alias || /^accompanying naturalist/i.test(a.name.trim())) continue;
      const city = cityOfAddon(a);
      if (city && !tripCities.some((c) => sameCity(c, city))) continue;
      // a Pugdundee-wide experience offered only at some lodges: hidden if none of them is in this trip
      if (!a.property_id && a.offered_at?.length && !a.offered_at.some((id) => parkLodges.has(id))) continue;
      const k = normName(a.name);
      byName.set(k, [...(byName.get(k) ?? []), a]);
    }
    const groups = [...byName.entries()].map(([key, entries]) => {
      const shared = entries.length > 1 || entries.some((e) => !e.property_id);
      return { key, name: entries[0].name, entries, shared, lodgeId: shared ? null : entries[0].property_id, unit: entries[0].pricing_unit, city: cityOfAddon(entries[0]) };
    });
    return groups
      .filter((g) => g.shared || (g.lodgeId && parkLodges.has(g.lodgeId)))
      .filter((g) => !search || g.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => Number(!!a.city) - Number(!!b.city) || (a.city ?? "").localeCompare(b.city ?? "") || Number(b.shared) - Number(a.shared) || lodgeName(a.lodgeId).localeCompare(lodgeName(b.lodgeId)) || a.name.localeCompare(b.name));
  })();
  type AddonGroup = (typeof addonGroups)[number];
  // The add-on for a given day: that day's lodge's own, else the general one, else any.
  const addonFor = (g: AddonGroup, dayIndex: number) => {
    const day = plan.days[dayIndex];
    const lodge = day?.property_id ?? day?.city_hotel?.property_id ?? (day?.stay_index !== undefined ? hotelIdOf(plan.city_stays?.[day.stay_index]?.hotel) : undefined) ?? null;
    return (
      g.entries.find((e) => e.property_id === lodge) ??
      g.entries.find((e) => !e.property_id && (!e.offered_at?.length || (lodge && e.offered_at.includes(lodge)))) ??
      g.entries.find((e) => !e.property_id) ??
      g.entries[0]
    );
  };
  // What one unit of an add-on costs on a day, as the costing works it out:
  // that day's lodge's own price, the foreign rate for foreign guests, the yearly hike.
  const hike = ctx.pricing.settings.hike ?? null;
  const unitPrice = (a: (typeof ctx.pricing.addons)[number], dayIndex: number) => {
    const foreign = plan.guest.nationality === "foreign";
    const base = foreign && a.rate_foreign != null ? a.rate_foreign : a.rate;
    const date = plan.days[dayIndex]?.date;
    const pct = hike?.addons_pct && (plan.rate_basis ? plan.rate_basis.year === "next" : !!date && date >= hike.from && date <= hike.to) ? hike.addons_pct : 0;
    return { rate: Math.round(base * (1 + pct / 100)), hike: pct, tax: Number(a.tax_pct) || 0 };
  };
  // The costing line for an add-on on a day (by the add-on itself, not its name).
  const addonLine = (date: string, addonId: string) => result?.lines.find((l) => l.date === date && l.kind === "addon" && l.ref_id === addonId);
  const UNIT_TEXT: Record<string, string> = { per_person: "per person", per_group: "per group", per_vehicle: "per jeep", per_room: "per room" };

  // ---- day edits
  const setDay = (i: number, fn: (d: PlanDay) => PlanDay) => setPlan((p) => ({ ...p, days: p.days.map((d, j) => (j === i ? fn(d) : d)) }));

  function setSafari(i: number, session: DaySafari["session"], zone: "" | DaySafari["zone"]) {
    const day = plan.days[i];
    const old = day.safaris.find((s) => s.session === session);
    const safaris = day.safaris.filter((s) => s.session !== session && s.session !== "full_day");
    if (zone) safaris.push({ session, zone, ...(old?.naturalist ? { naturalist: true } : {}), ...(old?.jeeps ? { jeeps: old.jeeps } : {}) });
    safaris.sort((a, b) => (a.session === b.session ? 0 : a.session === "morning" ? -1 : 1));
    let kind = day.kind;
    if (kind === "safari" || kind === "leisure") kind = safaris.length ? "safari" : "leisure";
    const autoText = describe(ctx, day, plan.vehicle_type).text;
    const next: PlanDay = { ...day, safaris, kind };
    setDay(i, () => (day.text === autoText ? describe(ctx, next, plan.vehicle_type) : next));
  }

  // Full-day safari: one safari for the whole day instead of morning and evening.
  function setFullDay(i: number, zone: "" | DaySafari["zone"]) {
    const day = plan.days[i];
    const safaris: DaySafari[] = zone ? [{ session: "full_day", zone, ...(day.safaris[0]?.naturalist ? { naturalist: true } : {}) }] : [];
    let kind = day.kind;
    if (kind === "safari" || kind === "leisure") kind = safaris.length ? "safari" : "leisure";
    const autoText = describe(ctx, day, plan.vehicle_type).text;
    const next: PlanDay = { ...day, safaris, kind };
    setDay(i, () => (day.text === autoText ? describe(ctx, next, plan.vehicle_type) : next));
  }
  // Jeeps on one safari; empty = enough for the group (1 jeep up to 6 guests).
  const setJeeps = (i: number, session: DaySafari["session"], jeeps: number | null) =>
    setDay(i, (d) => ({
      ...d,
      safaris: d.safaris.map((x) => {
        if (x.session !== session) return x;
        const next: DaySafari = { session: x.session, zone: x.zone, ...(x.naturalist ? { naturalist: true } : {}) };
        return jeeps ? { ...next, jeeps } : next;
      }),
    }));

  // Naturalist on one safari of a day (one per safari: never more than the safaris).
  function setNaturalist(i: number, session: DaySafari["session"], on: boolean) {
    const day = plan.days[i];
    const next: PlanDay = { ...day, safaris: day.safaris.map((s) => (s.session === session ? { ...s, naturalist: on } : s)) };
    const autoText = describe(ctx, day, plan.vehicle_type).text;
    setDay(i, () => (day.text === autoText ? describe(ctx, next, plan.vehicle_type) : next));
  }

  function addItem(dayIndex: number, item: Omit<PlanItem, "id">) {
    setDay(dayIndex, (d) => ({ ...d, items: [...(d.items ?? []), { ...item, id: newId() }] }));
  }
  function moveItem(id: string, from: number, to: number) {
    if (from === to) return;
    setPlan((p) => {
      const found = p.days[from]?.items.find((x) => x.id === id);
      if (!found) return p;
      // an add-on moved to a day at another lodge takes that lodge's price
      let it = found;
      if (found.addon_id) {
        const name = ctx.pricing.addons.find((a) => a.id === found.addon_id)?.name;
        const g = name ? addonGroups.find((x) => x.key === normName(name)) : undefined;
        if (g) it = { ...found, addon_id: addonFor(g, to).id };
      }
      return { ...p, days: p.days.map((d, j) => (j === from ? { ...d, items: d.items.filter((x) => x.id !== id) } : j === to ? { ...d, items: [...d.items, it] } : d)) };
    });
  }
  const updateItem = (dayIndex: number, id: string, patch: Partial<PlanItem>) =>
    setDay(dayIndex, (d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const removeItem = (dayIndex: number, id: string) => setDay(dayIndex, (d) => ({ ...d, items: d.items.filter((x) => x.id !== id) }));

  // ---- drag and drop (mouse); tap/click "Add" works everywhere, including phones
  const onDragStart = (e: React.DragEvent, data: DragData) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data));
    e.dataTransfer.effectAllowed = data.kind === "new" ? "copy" : "move";
  };
  const onDrop = (e: React.DragEvent, dayIndex: number) => {
    e.preventDefault();
    setOverDay(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as DragData;
      if (data.kind === "new" && data.group) {
        const g = addonGroups.find((x) => x.key === data.group);
        if (g) addItem(dayIndex, addonItem(addonFor(g, dayIndex)));
      } else if (data.kind === "new") addItem(dayIndex, data.item);
      else moveItem(data.id, data.from, dayIndex);
      setTargetDay(dayIndex);
    } catch {
      /* not one of ours */
    }
  };

  const customItem = (): Omit<PlanItem, "id"> | null => {
    const price = Number(custom.price);
    if (custom.type === "flight") {
      if (!flight.from.trim() || !flight.to.trim()) return null;
      const fare = Number(flight.fare);
      const f = {
        from: flight.from.trim(),
        to: flight.to.trim(),
        airline: flight.airline.trim(),
        number: flight.number.trim(),
        time: flight.time.trim(),
        ...(flight.arrive.trim() ? { arrive: flight.arrive.trim() } : {}),
        ...(flight.route_id ? { route_id: flight.route_id } : {}),
        pnr: flight.pnr.trim(),
        ...(Number.isFinite(fare) && fare > 0 ? { fare_pp: Math.round(fare) } : {}),
        cabin: flight.cabin.trim() || "Economy",
        baggage: flight.baggage.trim(),
      };
      return { type: "flight", title: `Flight ${f.from} to ${f.to}`, detail: custom.detail.trim() || `${f.cabin} class${f.baggage ? ` (${f.baggage})` : ""}`, price: null, addon_id: null, qty: null, flight: f };
    }
    const title = custom.title.trim();
    if (!title) return null;
    return { type: custom.type, title, detail: custom.detail.trim(), price: Number.isFinite(price) && price > 0 ? Math.round(price) : null, addon_id: null, qty: null };
  };
  const addonItem = (a: (typeof ctx.pricing.addons)[number]): Omit<PlanItem, "id"> => ({ type: "addon", title: a.name, detail: "", price: null, addon_id: a.id, qty: null });

  const stillNeeded = (result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined);

  const setGuest = (patch: Partial<Plan["guest"]>) => setPlan((p) => ({ ...p, guest: { ...p.guest, ...patch } }));
  const detail = result ? detailedBreakdown(result, { spreadMarkup: false }).rows : [];
  const editedCount = Object.keys(plan.line_prices ?? {}).length;
  const setLinePrice = (key: string, v: number | null) =>
    setPlan((p) => {
      const lp = { ...(p.line_prices ?? {}) };
      if (v === null) delete lp[key];
      else lp[key] = Math.max(0, Math.round(v));
      return { ...p, line_prices: lp };
    });

  return (
    <div className="space-y-4">
      {/* ---------- guests: change them here and the price follows ---------- */}
      <section className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-sand-200 bg-white px-3 py-2.5 text-sm" aria-label="Guests and rooms">
        <span className="self-center font-semibold text-olive-800">Guests</span>
        <label className="flex items-center gap-1.5 text-xs text-sand-600">
          Adults
          <input
            type="number"
            min={1}
            max={50}
            className="tabular w-14 rounded-md border border-sand-300 px-2 py-1 text-sm"
            value={plan.guest.adults}
            onChange={(e) => {
              const adults = Math.max(1, Math.min(50, Number(e.target.value) || 1));
              setGuest({ adults, rooms: roomsFor(adults, plan.guest.rooms) });
            }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-sand-600">
          Kids&apos; ages
          <input
            className="w-24 rounded-md border border-sand-300 px-2 py-1 text-sm"
            placeholder="8, 12"
            value={childrenText}
            onChange={(e) => setChildrenText(e.target.value)}
            onBlur={() => {
              const ages = childrenText.split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 18);
              setGuest({ children: ages });
              setChildrenText(ages.join(", "));
            }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-sand-600">
          Rooms
          <input
            type="number"
            min={1}
            max={30}
            className="tabular w-14 rounded-md border border-sand-300 px-2 py-1 text-sm"
            value={plan.guest.rooms}
            onChange={(e) => setGuest({ rooms: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-sand-600" title="Vehicles on every transfer. Empty = enough for the group. Change one road on its own day.">
          Transfer vehicles
          <input
            type="number"
            min={1}
            max={20}
            placeholder="auto"
            disabled={!!plan.own_vehicle}
            className="tabular w-16 rounded-md border border-sand-300 px-2 py-1 text-sm disabled:opacity-50"
            value={plan.transfer_vehicles ?? ""}
            onChange={(e) => setPlan((p) => ({ ...p, transfer_vehicles: e.target.value === "" ? null : Math.max(1, Math.min(20, Math.round(Number(e.target.value)) || 1)) }))}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-sand-600" title="The guests drive themselves: no transfers are planned or charged">
          <input type="checkbox" className="h-4 w-4" checked={!!plan.own_vehicle} onChange={(e) => setPlan((p) => ({ ...p, own_vehicle: e.target.checked || undefined }))} />
          Own vehicle (no transfers)
        </label>
        <span className="self-center text-[11px] text-sand-500">Prices update as you change these. Save a new version to share the new price.</span>
        {plan.dateless && (
          <span className="self-center rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-olive-800 ring-1 ring-gold-200">
            Dates not fixed: {plan.rate_basis?.season ?? "high"} season, {plan.rate_basis?.safari_days ?? "weekday"} safari rates
          </span>
        )}
      </section>

      {/* ---------- prices master data does not have ---------- */}
      {result && result.missing.length > 0 && (
        <section className="rounded-xl border border-warning-border bg-warning-bg p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-warning">
              {stillNeeded.length ? `${stillNeeded.length} price${stillNeeded.length === 1 ? "" : "s"} needed` : "All missing prices entered"}
            </h2>
            <p className="text-xs text-sand-600">Not in master data. Type the price, or save a draft and finish later.</p>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {result.missing.map((m) => (
              <label key={m.key} className="flex items-center gap-2 rounded-lg border border-sand-200 bg-white px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-olive-800" title={m.label}>{m.label}</span>
                  <span className="block text-[11px] text-sand-500">{m.unit}</span>
                </span>
                <span className="text-xs text-sand-500">Rs</span>
                <input
                  type="number"
                  min={0}
                  className="tabular w-24 rounded-md border border-sand-300 px-2 py-1 text-right text-sm"
                  value={plan.manual_prices?.[m.key] ?? ""}
                  onChange={(e) =>
                    setPlan((p) => {
                      const mp = { ...(p.manual_prices ?? {}) };
                      if (e.target.value === "") delete mp[m.key];
                      else mp[m.key] = Math.max(0, Math.round(Number(e.target.value)));
                      return { ...p, manual_prices: mp };
                    })
                  }
                  aria-label={`Price for ${m.label}`}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------- days ---------- */}
        <section className="space-y-2" aria-label="Day by day">
          {plan.days.map((d, i) => {
            const isTarget = targetDay === i;
            return (
              <div
                key={d.date + i}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                    e.preventDefault();
                    setOverDay(i);
                  }
                }}
                onDragLeave={() => setOverDay((x) => (x === i ? null : x))}
                onDrop={(e) => onDrop(e, i)}
                className={`rounded-xl border bg-white transition ${overDay === i ? "border-olive-600 ring-2 ring-olive-200" : isTarget ? "border-2 border-olive-600 shadow-card" : "border-sand-200"}`}
              >
                <button
                  type="button"
                  onClick={() => setTargetDay(i)}
                  aria-pressed={isTarget}
                  className={`flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left ${isTarget ? "rounded-t-xl border-olive-200 bg-olive-50" : "border-sand-100"}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className={`text-sm text-olive-700 ${isTarget ? "font-bold" : "font-semibold"}`}>Day {i + 1}</span>
                    {isTarget && <span className="rounded-full bg-olive-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Adding here</span>}
                    {!plan.dateless && <span className="text-xs uppercase tracking-wide text-sand-500">{dayName(d.date)} {fmtDate(d.date)}</span>}
                  </span>
                  <span className="truncate text-xs text-sand-500">{d.property_id ? lodgeName(d.property_id) : d.kind === "city" ? d.title || "City stay" : d.title || "Departure"}</span>
                </button>

                <ul className="divide-y divide-sand-100 text-sm">
                  {d.stay_index !== undefined && stays[d.stay_index] && plan.days.findIndex((x) => x.stay_index === d.stay_index) === i && (() => {
                    const k = d.stay_index!;
                    const c = stays[k];
                    return (
                      <li className="flex flex-wrap items-center gap-1.5 bg-sand-50 px-3 py-2 text-xs">
                        <Icon name="building" className="h-4 w-4 shrink-0 text-sand-500" />
                        <input
                          className="w-28 rounded border border-sand-200 bg-white px-1.5 py-1"
                          placeholder={c.blank ? "Place (optional)" : "City"}
                          value={c.city}
                          onChange={(e) => updateStay(k, { city: e.target.value.slice(0, 60) })}
                          aria-label="Place"
                        />
                        <input
                          className="min-w-0 flex-1 rounded border border-sand-200 bg-white px-1.5 py-1"
                          placeholder="Hotel (empty = to be confirmed)"
                          value={c.hotel ?? ""}
                          onChange={(e) => updateStay(k, { hotel: e.target.value.slice(0, 120) })}
                          aria-label="Hotel"
                        />
                        <label className="flex items-center gap-1 text-sand-500" title="Price per night for all rooms, incl. tax">
                          Rs
                          <input
                            type="number"
                            min={0}
                            className="tabular w-24 rounded border border-sand-200 bg-white px-1.5 py-1 text-right"
                            placeholder={d.city_hotel ? "Master rate" : "per night"}
                            title={d.city_hotel ? "Priced from this hotel's rates in Master data. Type a price to use your own instead." : "Price per night for all rooms, incl. tax"}
                            value={c.price ?? ""}
                            onChange={(e) => updateStay(k, { price: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) })}
                            aria-label="Hotel price per night, all rooms"
                          />
                          /night
                        </label>
                        <label className="flex items-center gap-1 text-sand-500">
                          Nights
                          <input
                            type="number"
                            min={1}
                            max={14}
                            className="tabular w-12 rounded border border-sand-200 bg-white px-1.5 py-1 text-right"
                            value={c.nights}
                            onChange={(e) => updateStay(k, { nights: Math.max(1, Math.min(14, Math.round(Number(e.target.value)) || 1)) })}
                            aria-label="Nights"
                          />
                        </label>
                        <button type="button" onClick={() => removeStay(k)} className="rounded p-1 text-sand-400 hover:bg-error-bg hover:text-error" aria-label={c.blank ? "Remove this day" : `Remove the nights in ${c.city}`}>
                          <Icon name="trash" className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })()}
                  {d.kind === "city" && d.text && (
                    <li className="flex items-center gap-2 px-3 py-1.5 text-xs text-sand-600">
                      <Icon name="building" className="h-4 w-4 shrink-0 text-sand-500" />
                      <span className="flex-1">{d.text}</span>
                    </li>
                  )}
                  {d.notes.map((n, k) => (
                    <li key={`n${k}`} className="flex gap-2 px-3 py-1.5 text-xs text-warning">
                      <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {n}
                    </li>
                  ))}
                  {d.transfer && (
                    <li className="flex items-center gap-2 px-3 py-1.5">
                      <Icon name="car" className="h-4 w-4 shrink-0 text-sand-500" />
                      <span className="flex-1 truncate">
                        {locName(d.transfer.from_location_id)} to{" "}
                        {/* the last lodge day before city nights: the drive is to the city hotel */}
                        {d.kind === "departure" && stayOf(d)?.city ? (stayOf(d)!.hotel ? `${stayOf(d)!.hotel}, ${stayOf(d)!.city}` : stayOf(d)!.city) : locName(d.transfer.to_location_id)}
                      </span>
                      {vehiclesBox(d.transfer.from_location_id, d.transfer.to_location_id, d.date, locName(d.transfer.from_location_id), locName(d.transfer.to_location_id))}
                    </li>
                  )}
                  {(d.city_transfers ?? []).map((t, k) => (
                    <li key={`ct${k}`} className="flex items-center gap-2 px-3 py-1.5">
                      <Icon name="car" className="h-4 w-4 shrink-0 text-sand-500" />
                      <span className="flex-1 truncate">
                        {t.from_label} to {t.to_label}
                      </span>
                      {missingKeys.has(`transfer|${d.date}|${t.from_location_id}|${t.to_location_id}`) && !plan.own_vehicle && plan.route_vehicles?.[routeOf(t.from_location_id, t.to_location_id)] !== 0 && (
                        <span className="shrink-0 rounded bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning">Price needed (top of page)</span>
                      )}
                      {vehiclesBox(t.from_location_id, t.to_location_id, d.date, t.from_label, t.to_label)}
                    </li>
                  ))}
                  {d.park_id && (() => {
                    const fullDay = d.safaris.find((x) => x.session === "full_day");
                    const extras = (safari: DaySafari) => (
                      <>
                        <label className="flex items-center gap-1 rounded-md bg-sand-50 px-1.5 py-0.5" title="Accompanying naturalist on this safari">
                          <input type="checkbox" className="h-3.5 w-3.5" checked={!!safari.naturalist} onChange={(e) => setNaturalist(i, safari.session, e.target.checked)} />
                          Naturalist
                        </label>
                        <label className="flex items-center gap-1 rounded-md bg-sand-50 px-1.5 py-0.5" title="Jeeps on this safari. Empty = enough for the group (6 guests per jeep).">
                          Jeeps
                          <input
                            type="number"
                            min={1}
                            max={10}
                            placeholder={String(autoJeeps)}
                            className="tabular w-10 rounded border border-sand-300 bg-white px-1 py-0 text-right text-xs"
                            value={safari.jeeps ?? ""}
                            onChange={(e) => setJeeps(i, safari.session, e.target.value === "" ? null : Math.max(1, Math.min(10, Math.round(Number(e.target.value)))))}
                            aria-label="Jeeps on this safari"
                          />
                        </label>
                      </>
                    );
                    // One line per safari, in order: full day, morning, evening. A full-day
                    // safari replaces the morning and evening ones (and the other way round).
                    const ROWS = [
                      { session: "full_day" as const, label: "Full day safari" },
                      { session: "morning" as const, label: "Morning safari" },
                      { session: "afternoon" as const, label: "Evening safari" },
                    ];
                    return (
                      <li className="space-y-1 px-3 py-1.5">
                        {ROWS.map(({ session, label }) => {
                          const closedCore = closed(d.park_id!, "core", session, d.date);
                          const closedBuffer = closed(d.park_id!, "buffer", session, d.date);
                          const safari = d.safaris.find((x) => x.session === session);
                          const value = safari?.zone ?? "";
                          const onClosed = (value === "core" && closedCore) || (value === "buffer" && closedBuffer);
                          const coveredByFullDay = session !== "full_day" && !!fullDay;
                          return (
                            <div key={session} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sand-600">
                              <Icon name={session === "morning" ? "clock" : session === "afternoon" ? "route" : "calendar"} className="h-3.5 w-3.5 shrink-0 text-sand-400" />
                              <span className="w-28 shrink-0 font-medium text-olive-800">{label}</span>
                              {coveredByFullDay ? (
                                <span className="text-sand-400">Included in the full-day safari</span>
                              ) : closedCore && closedBuffer && !value ? (
                                <span className="text-sand-400">Park closed</span>
                              ) : (
                                <>
                                  <select
                                    className={`rounded-md border bg-white px-1.5 py-0.5 text-xs ${onClosed ? "border-error text-error" : "border-sand-300"}`}
                                    value={value}
                                    onChange={(e) => {
                                      const z = e.target.value as "" | "core" | "buffer";
                                      if (session === "full_day") setFullDay(i, z);
                                      else setSafari(i, session, z);
                                    }}
                                    aria-label={label}
                                  >
                                    <option value="">No</option>
                                    {(!closedCore || value === "core") && <option value="core">{closedCore ? "Core (closed)" : "Core"}</option>}
                                    {(!closedBuffer || value === "buffer") && <option value="buffer">{closedBuffer ? "Buffer (closed)" : "Buffer"}</option>}
                                  </select>
                                  {safari && extras(safari)}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </li>
                    );
                  })()}
                  {(d.items ?? []).map((it) => (
                    <li
                      key={it.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, { kind: "move", id: it.id, from: i })}
                      className="group flex items-center gap-2 bg-olive-50/40 px-2 py-1.5"
                    >
                      <span className="cursor-grab text-sand-400" title="Drag to another day" aria-hidden="true">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></svg>
                      </span>
                      <Icon name={TYPE_ICON[it.type]} className="h-4 w-4 shrink-0 text-olive-600" />
                      <input
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-sand-200 focus:border-sand-300 focus:bg-white"
                        value={it.title}
                        onChange={(e) => updateItem(i, it.id, { title: e.target.value })}
                        aria-label="Item name"
                      />
                      {it.type === "flight" && (
                        <span className="hidden max-w-[40%] truncate text-[11px] text-sand-500 sm:inline" title={flightSummary(it.flight)}>
                          {flightSummary(it.flight)}
                        </span>
                      )}
                      {it.addon_id ? (
                        (() => {
                          const l = addonLine(d.date, it.addon_id);
                          const unit = ctx.pricing.addons.find((a) => a.id === it.addon_id)?.pricing_unit;
                          const unitWord = unit === "per_person" ? "Guests" : unit === "per_vehicle" ? "Vehicles" : unit === "per_room" ? "Rooms" : "Qty";
                          // how many: automatic (guests, jeeps, rooms) unless typed here
                          const qtyBox = (
                            <label className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500" title={`${unitWord} charged. Empty = automatic.`}>
                              {unitWord}
                              <input
                                type="number"
                                min={1}
                                max={500}
                                placeholder={l ? String(l.quantity) : "auto"}
                                className="tabular w-12 rounded border border-sand-200 px-1.5 py-0.5 text-right text-xs"
                                value={it.qty ?? ""}
                                onChange={(e) => updateItem(i, it.id, { qty: e.target.value === "" ? null : Math.max(1, Math.min(500, Math.round(Number(e.target.value)) || 1)) })}
                                aria-label={`${unitWord} for ${it.title}`}
                              />
                            </label>
                          );
                          if (!l) return <span className="flex shrink-0 items-center gap-2">{qtyBox}<span className="tabular text-xs text-sand-600">-</span></span>;
                          const how = `${l.quantity} x ${rupees(l.unit_price)}${l.tax_pct ? ` + ${l.tax_pct}% GST` : ""} = ${rupees(l.amount)}`;
                          return (
                            <span className="flex shrink-0 items-center gap-2">
                              {qtyBox}
                              <span className="tabular text-right text-xs leading-tight text-sand-600" title={how}>
                                {rupees(l.amount)}
                                <span className="block text-[10px] text-sand-400">{l.quantity} x {rupees(l.unit_price)}{l.tax_pct ? " + GST" : ""}</span>
                              </span>
                            </span>
                          );
                        })()
                      ) : it.type === "flight" && it.flight ? (
                        <label className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500" title="Fare per person (typed, not live). Total = fare x guests.">
                          <input
                            type="number"
                            min={0}
                            placeholder="Fare pp"
                            className="tabular w-20 rounded border border-sand-200 px-1.5 py-0.5 text-right text-xs"
                            value={it.flight.fare_pp ?? ""}
                            onChange={(e) => {
                              const v = e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value)));
                              updateItem(i, it.id, { price: null, flight: { ...it.flight!, fare_pp: v } });
                            }}
                            aria-label="Fare per person"
                          />
                          pp
                        </label>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          placeholder="Price"
                          className="tabular w-20 shrink-0 rounded border border-sand-200 px-1.5 py-0.5 text-right text-xs"
                          value={it.price ?? ""}
                          onChange={(e) => updateItem(i, it.id, { price: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))) })}
                          aria-label="Price in rupees"
                        />
                      )}
                      <select
                        className="w-[4.5rem] shrink-0 rounded border border-sand-200 bg-white px-1 py-0.5 text-[11px] sm:hidden"
                        value={i}
                        onChange={(e) => moveItem(it.id, i, Number(e.target.value))}
                        aria-label="Move to day"
                      >
                        {plan.days.map((_, j) => <option key={j} value={j}>Day {j + 1}</option>)}
                      </select>
                      <button type="button" onClick={() => removeItem(i, it.id)} className="shrink-0 rounded p-1 text-sand-400 hover:bg-error-bg hover:text-error" aria-label={`Remove ${it.title}`}>
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {!d.items?.length && (
                    <li className="px-3 py-1.5 text-center text-[11px] italic text-sand-400">{overDay === i ? "Drop here" : "Drag items here, or select this day and click Add"}</li>
                  )}
                </ul>
                <div className="flex flex-wrap items-center gap-1.5 border-t border-sand-100 px-3 py-1.5">
                  {addMenu === i ? (
                    <>
                      {(() => {
                        const c = stayOf(d);
                        const seg = c ? undefined : lodgeSegOf(d);
                        const label = c ? `Another night ${c.city ? `in ${c.city}` : "here"}` : seg ? `Another night at ${lodgeName(seg.stop.property_id)}` : null;
                        return label ? (
                          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => addDayAfter(i, "night")}>
                            {label}
                          </button>
                        ) : null;
                      })()}
                      <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => addDayAfter(i, "blank")} title="A new day with its own hotel and price; add experiences or custom items to it">
                        Blank day {lodgeSegOf(d) ? `after ${lodgeName(lodgeSegOf(d)!.stop.property_id)}` : "after this"}
                      </button>
                      <button type="button" className="text-[11px] text-sand-500 hover:underline" onClick={() => setAddMenu(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="text-[11px] font-semibold text-olive-700 hover:underline" onClick={() => setAddMenu(i)}>
                      + Add a day
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* ---------- items to add ---------- */}
        <aside className="space-y-2 xl:sticky xl:top-36 xl:max-h-[calc(100vh-10rem)] xl:self-start xl:overflow-y-auto" aria-label="Add items">
          <div className={`${ui.card} overflow-hidden`}>
            <div className="flex border-b border-sand-200 text-sm">
              {(["addons", "custom"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 border-b-2 px-3 py-2 font-medium ${tab === t ? "border-olive-600 text-olive-800" : "border-transparent text-sand-500 hover:text-olive-700"}`}
                >
                  {t === "addons" ? "Add-ons" : "Custom item"}
                </button>
              ))}
            </div>
            <p className="border-b border-sand-100 bg-sand-50 px-3 py-1.5 text-[11px] text-sand-600">
              Adding to <b className="text-olive-800">Day {targetDay + 1}</b>. Click a day to change, or drag an item onto any day.
            </p>

            {tab === "addons" ? (
              <div className="space-y-2 p-3">
                <input className={ui.inputSm} placeholder="Search add-ons" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search add-ons" />
                {addonGroups.length === 0 ? (
                  <p className="py-4 text-center text-xs text-sand-500">No experiences for these lodges. Use Custom item, or add them in Master data.</p>
                ) : (
                  <ul className="max-h-[440px] space-y-1.5 overflow-y-auto">
                    {addonGroups.map((g, k) => {
                      const u = unitPrice(addonFor(g, targetDay), targetDay);
                      const header = k === 0 || addonGroups[k - 1].shared !== g.shared || addonGroups[k - 1].lodgeId !== g.lodgeId || addonGroups[k - 1].city !== g.city;
                      return (
                        <li key={g.key}>
                          {header && (
                            <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-sand-500 first:mt-0">
                              {g.city ? `In ${g.city}` : g.shared ? "Pugdundee experiences" : `Only at ${lodgeName(g.lodgeId)}`}
                            </p>
                          )}
                          <div
                            draggable
                            onDragStart={(e) => onDragStart(e, { kind: "new", item: addonItem(g.entries[0]), group: g.key })}
                            className="flex cursor-grab items-center gap-2 rounded-lg border border-sand-200 px-2.5 py-1.5 hover:border-olive-300 hover:bg-olive-50/50"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-olive-800">{g.name}</span>
                              <span className="block truncate text-[11px] text-sand-500">
                                {rupees(u.rate)} {UNIT_TEXT[g.unit] ?? g.unit.replace("_", " ")} {u.tax ? `+ ${u.tax}% GST` : "(no GST)"}
                                {u.hike ? ` (incl. ${u.hike}% hike)` : ""}
                              </span>
                            </span>
                            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm} !min-h-7 shrink-0 !px-2`} onClick={() => addItem(targetDay, addonItem(addonFor(g, targetDay)))}>
                              Add
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <div className="space-y-2 p-3">
                <select className={`${ui.select} w-full !py-1.5 text-sm`} value={custom.type} onChange={(e) => setCustom((c) => ({ ...c, type: e.target.value as PlanItem["type"] }))} aria-label="Item type">
                  {(["activity", "hotel", "flight", "transfer", "meal", "note"] as const).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
                {custom.type === "flight" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <datalist id="lq-airports">{AIRPORTS.map((a) => <option key={a} value={a} />)}</datalist>
                    {(ctx.flightRoutes ?? []).length > 0 && (
                      <select
                        className={`${ui.select} col-span-2 w-full !py-1.5 text-sm`}
                        value={flight.route_id}
                        onChange={(e) => {
                          const r = (ctx.flightRoutes ?? []).find((x) => x.id === e.target.value);
                          if (!r) return setFlight((f) => ({ ...f, route_id: "" }));
                          setFlight((f) => ({
                            ...f,
                            route_id: r.id,
                            from: r.from_city,
                            to: r.to_city,
                            airline: r.airline,
                            number: r.flight_no,
                            time: r.depart_time,
                            arrive: r.arrive_time,
                            fare: String(r.fare),
                            cabin: r.cabin || "Economy",
                          }));
                        }}
                        aria-label="Pick a flight from Master data"
                      >
                        <option value="">Pick a flight ({routes.length} match{routes.length === 1 ? "" : "es"}), or type below</option>
                        {routes.slice(0, 80).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.from_city} to {r.to_city}
                            {r.airline || r.flight_no ? ` \u00b7 ${[r.airline, r.flight_no].filter(Boolean).join(" ")}` : ""}
                            {r.depart_time ? ` \u00b7 ${r.depart_time}${r.arrive_time ? `-${r.arrive_time}` : ""}` : ""}
                            {` \u00b7 Rs ${r.fare.toLocaleString("en-IN")} pp`}
                          </option>
                        ))}
                      </select>
                    )}
                    <input className={ui.inputSm} list="lq-airports" placeholder="From, e.g. Delhi" value={flight.from} onChange={(e) => setFlight((f) => ({ ...f, from: e.target.value, route_id: "" }))} aria-label="Flight from" />
                    <input className={ui.inputSm} list="lq-airports" placeholder="To, e.g. Jabalpur" value={flight.to} onChange={(e) => setFlight((f) => ({ ...f, to: e.target.value, route_id: "" }))} aria-label="Flight to" />
                    <input className={ui.inputSm} placeholder="Airline" value={flight.airline} onChange={(e) => setFlight((f) => ({ ...f, airline: e.target.value }))} aria-label="Airline" />
                    <input className={ui.inputSm} placeholder="Flight no." value={flight.number} onChange={(e) => setFlight((f) => ({ ...f, number: e.target.value }))} aria-label="Flight number" />
                    <label className="flex items-center gap-1.5 text-[11px] text-sand-500">
                      Take-off
                      <input className={ui.inputSm} type="time" value={flight.time} onChange={(e) => setFlight((f) => ({ ...f, time: e.target.value }))} aria-label="Take-off time" />
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-sand-500">
                      Landing
                      <input className={ui.inputSm} type="time" value={flight.arrive} onChange={(e) => setFlight((f) => ({ ...f, arrive: e.target.value }))} aria-label="Landing time" />
                    </label>
                    <input className={ui.inputSm} placeholder="PNR (once booked)" value={flight.pnr} onChange={(e) => setFlight((f) => ({ ...f, pnr: e.target.value }))} aria-label="PNR" />
                    <input className={`${ui.inputSm} tabular`} type="number" min={0} placeholder="Fare per person, Rs" value={flight.fare} onChange={(e) => setFlight((f) => ({ ...f, fare: e.target.value }))} aria-label="Fare per person" />
                    <input className={ui.inputSm} placeholder="Class, e.g. Economy" value={flight.cabin} onChange={(e) => setFlight((f) => ({ ...f, cabin: e.target.value }))} aria-label="Class" />
                    <input className={`${ui.inputSm} col-span-2`} placeholder="Baggage" value={flight.baggage} onChange={(e) => setFlight((f) => ({ ...f, baggage: e.target.value }))} aria-label="Baggage" />
                    <p className="col-span-2 text-[11px] text-sand-500">
                      The fare is typed, not live: total = fare x {guests} guest{guests === 1 ? "" : "s"}, and it follows the guest count. The guest sees the flight on its own, just before this day.
                    </p>
                  </div>
                ) : (
                  <input className={ui.inputSm} placeholder="Name, e.g. Village walk, Taj Hotel Jabalpur" value={custom.title} onChange={(e) => setCustom((c) => ({ ...c, title: e.target.value }))} aria-label="Item name" />
                )}
                <input className={ui.inputSm} placeholder="Details for the guest (optional)" value={custom.detail} onChange={(e) => setCustom((c) => ({ ...c, detail: e.target.value }))} aria-label="Item details" />
                {custom.type !== "flight" && (
                  <input
                    className={`${ui.inputSm} tabular`}
                    type="number"
                    min={0}
                    placeholder="Price in Rs, incl. tax (empty = no charge)"
                    value={custom.price}
                    onChange={(e) => setCustom((c) => ({ ...c, price: e.target.value }))}
                    aria-label="Item price"
                  />
                )}
                {(() => {
                  const item = customItem();
                  return (
                    <div
                      draggable={!!item}
                      onDragStart={(e) => item && onDragStart(e, { kind: "new", item })}
                      className="flex items-center gap-2"
                    >
                      <button
                        type="button"
                        className={`${ui.btnPrimary} ${ui.btnSm} flex-1`}
                        disabled={!item}
                        onClick={() => {
                          if (!item) return;
                          addItem(targetDay, item);
                          setCustom((c) => ({ ...c, title: "", detail: "", price: "" }));
                          setFlight({ from: "", to: "", airline: "", number: "", time: "", arrive: "", pnr: "", fare: "", cabin: "Economy", baggage: FLIGHT_BAGGAGE, route_id: "" });
                        }}
                      >
                        <Icon name="plus" className="h-4 w-4" />
                        Add to Day {targetDay + 1}
                      </button>
                      {item && <span className="text-[11px] text-sand-500">or drag me</span>}
                    </div>
                  );
                })()}
                <p className="text-[11px] text-sand-500">Use this for anything not in master data: another hotel, a city tour, a special dinner.</p>
              </div>
            )}
          </div>

          {/* ---------- discount, offers, markup, currency ---------- */}
          <details className={`${ui.card} group`} open={!!plan.discount || plan.offer_ids.length > 0 || plan.currency !== "INR" || plan.gst?.mode === "consolidated"}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-olive-800">
              <span className="flex-1">Discount, offers, currency and GST</span>
              {(plan.discount?.pct ?? 0) > 0 && <span className="rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-semibold text-olive-700">{plan.discount!.pct}% off</span>}
              {plan.offer_ids.length > 0 && <span className="rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-semibold text-olive-700">offer</span>}
              <Icon name="chevronLeft" className="h-4 w-4 -rotate-90 text-sand-500 transition group-open:rotate-90" />
            </summary>
            <div className="space-y-3 border-t border-sand-200 p-3 text-sm">
              {/* % discount: two clear choices instead of a dropdown */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`${ui.label} !mb-0 w-16`}>Discount</span>
                  <input
                    className="tabular w-16 rounded-md border border-sand-300 px-2 py-1.5 text-right text-sm"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    placeholder="0"
                    value={plan.discount?.pct ?? ""}
                    onChange={(e) => {
                      const pct = Math.max(0, Math.min(100, Number(e.target.value)));
                      setPlan((p) => ({ ...p, discount: e.target.value === "" || !pct ? null : { pct, scope: p.discount?.scope ?? "lodges", reason: p.discount?.reason ?? "" } }));
                    }}
                    aria-label="Discount percent"
                  />
                  <span className="text-sand-500">%</span>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-sand-100 p-1 text-xs" role="radiogroup" aria-label="Discount applies to">
                  {(["lodges", "all"] as const).map((sc) => {
                    const on = (plan.discount?.scope ?? "lodges") === sc;
                    return (
                      <button
                        key={sc}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setPlan((p) => ({ ...p, discount: { pct: p.discount?.pct ?? 0, reason: p.discount?.reason ?? "", scope: sc } }))}
                        className={`rounded-md px-2 py-1.5 font-medium ${on ? "bg-white text-olive-800 shadow-card" : "text-sand-600 hover:text-olive-700"}`}
                      >
                        {sc === "lodges" ? "Our lodges' rooms" : "Whole trip"}
                      </button>
                    );
                  })}
                </div>
                {(plan.discount?.pct ?? 0) > 0 && (
                  <input
                    className={`${ui.inputSm} ${!plan.discount?.reason.trim() ? "!border-error" : ""}`}
                    value={plan.discount?.reason ?? ""}
                    onChange={(e) => setPlan((p) => (p.discount ? { ...p, discount: { ...p.discount, reason: e.target.value } } : p))}
                    placeholder="Reason (internal, required), e.g. Repeat guest"
                    aria-label="Discount reason"
                  />
                )}
              </div>

              {/* offers, with what each needs */}
              {ctx.pricing.offers.length > 0 && (
                <div className="space-y-1 border-t border-sand-100 pt-2">
                  <p className={ui.label}>Offers</p>
                  {ctx.pricing.offers.map((o) => {
                    const ownIds = new Set(ctx.properties.filter((x) => x.kind === "own_lodge").map((x) => x.id));
                    const lodges = new Set(plan.stops.filter((st) => ownIds.has(st.property_id)).map((st) => st.property_id)).size;
                    const nights = plan.stops.reduce((t, st) => t + st.nights, 0);
                    const needL = o.offer_type === "multi_lodge" ? o.min_lodges ?? 2 : 0;
                    const ok = lodges >= needL && nights >= o.min_nights;
                    return (
                      <label key={o.id} className={`flex items-start gap-2 rounded-md px-1.5 py-1 ${ok ? "" : "opacity-60"}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0"
                          checked={plan.offer_ids.includes(o.id)}
                          onChange={(e) => setPlan((p) => ({ ...p, offer_ids: e.target.checked ? [...p.offer_ids, o.id] : p.offer_ids.filter((x) => x !== o.id) }))}
                        />
                        <span className="min-w-0 flex-1 leading-snug">
                          {o.name}
                          <span className={`block text-[11px] font-semibold ${ok ? "text-success" : "text-sand-500"}`}>
                            {ok ? "Qualifies" : `Needs ${needL ? `${needL} lodges, ` : ""}${o.min_nights} nights`}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* markup, currency, a manual adjustment */}
              <div className="grid grid-cols-2 gap-2 border-t border-sand-100 pt-2">
                <label className="block">
                  <span className={ui.label}>Markup %</span>
                  <input
                    className={ui.inputSm}
                    type="number"
                    step="any"
                    placeholder={String(ctx.pricing.settings.markup_pct ?? 0)}
                    value={plan.markup_pct ?? ""}
                    onChange={(e) => setPlan((p) => ({ ...p, markup_pct: e.target.value === "" ? null : Math.max(-50, Math.min(200, Number(e.target.value))) }))}
                  />
                </label>
                <label className="block">
                  <span className={ui.label}>Quote in</span>
                  <select className={`${ui.select} w-full !py-2`} value={plan.currency} onChange={(e) => setPlan((p) => ({ ...p, currency: e.target.value as Plan["currency"] }))}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              {plan.currency !== "INR" && (
                <div className="space-y-1 rounded-lg bg-sand-50 p-2">
                  <label className="flex items-center gap-2 text-xs text-sand-600">
                    <span className="whitespace-nowrap font-semibold text-olive-800">Rate of exchange</span>
                    <span className="whitespace-nowrap">1 {plan.currency} = Rs</span>
                    <input
                      className="tabular w-24 rounded-md border border-sand-300 bg-white px-2 py-1 text-right text-sm"
                      type="number"
                      min={0}
                      step="any"
                      placeholder={ctx.pricing.settings.fx?.[plan.currency] ? String(ctx.pricing.settings.fx[plan.currency]) : "e.g. 85"}
                      value={plan.fx_rate ?? ""}
                      onChange={(e) => setPlan((p) => ({ ...p, fx_rate: e.target.value === "" || !(Number(e.target.value) > 0) ? null : Number(e.target.value) }))}
                      aria-label={`Rupees per 1 ${plan.currency}`}
                    />
                  </label>
                  <p className="text-[11px] text-sand-500">
                    {plan.fx_rate
                      ? `Your rate is used for this quote${result?.grandInCurrency ? `: ${plan.currency} ${result.grandInCurrency.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : ""}.`
                      : ctx.pricing.settings.fx?.[plan.currency]
                        ? `Empty = ${ctx.pricing.settings.fx[plan.currency]!.toLocaleString("en-IN", { maximumFractionDigits: 2 })} (${ctx.pricing.settings.fx_source ?? "Sales settings"}). Type your own rate to fix it for this quote.`
                        : `No ${plan.currency} rate available right now: type the rate.`}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                <label className="block">
                  <span className={ui.label}>Adjust Rs</span>
                  <input
                    className={ui.inputSm}
                    type="number"
                    placeholder="-5000"
                    value={plan.adjustment?.amount ?? ""}
                    onChange={(e) => {
                      const amount = Number(e.target.value);
                      setPlan((p) => ({ ...p, adjustment: e.target.value === "" || !amount ? null : { amount, reason: p.adjustment?.reason ?? "" } }));
                    }}
                  />
                </label>
                <label className="block">
                  <span className={ui.label}>Reason {plan.adjustment && <span className="text-error">*</span>}</span>
                  <input
                    className={ui.inputSm}
                    disabled={!plan.adjustment}
                    value={plan.adjustment?.reason ?? ""}
                    onChange={(e) => setPlan((p) => (p.adjustment ? { ...p, adjustment: { ...p.adjustment, reason: e.target.value } } : p))}
                    placeholder="e.g. Rounding off"
                  />
                </label>
              </div>

              {/* GST: per service (each lodge's GST) or one rate on the whole package */}
              <div className="space-y-2 border-t border-sand-100 pt-2">
                <p className={ui.label}>GST</p>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-sand-100 p-1 text-xs" role="radiogroup" aria-label="GST">
                  {(["itemised", "consolidated"] as const).map((m) => {
                    const on = (plan.gst?.mode ?? "itemised") === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setPlan((p) => ({ ...p, gst: m === "consolidated" ? { mode: "consolidated", pct: p.gst?.pct ?? 5 } : null }))}
                        className={`rounded-md px-2 py-1.5 font-medium ${on ? "bg-white text-olive-800 shadow-card" : "text-sand-600 hover:text-olive-700"}`}
                      >
                        {m === "itemised" ? "Per service" : "One rate on the package"}
                      </button>
                    );
                  })}
                </div>
                {plan.gst?.mode === "consolidated" && (
                  <label className="flex items-center gap-2 text-xs text-sand-600">
                    GST on the whole package
                    <input
                      className="tabular w-16 rounded-md border border-sand-300 px-2 py-1 text-right text-sm"
                      type="number"
                      min={0}
                      max={28}
                      step="any"
                      value={plan.gst.pct}
                      onChange={(e) => setPlan((p) => ({ ...p, gst: { mode: "consolidated", pct: Math.max(0, Math.min(28, Number(e.target.value) || 0)) } }))}
                      aria-label="Package GST percent"
                    />
                    %
                  </label>
                )}
                <p className="text-[11px] text-sand-500">
                  One rate on the package: for payment to a single account, e.g. with outside hotels. Every service is taken before GST and one GST line is added on the total.
                </p>
              </div>
            </div>
          </details>

          {/* ---------- cost by lodge (internal) ---------- */}
          {result && result.byProperty.length > 0 && (
            <details className={`${ui.card} group`}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-olive-800">
                Cost by lodge (internal)
                <Icon name="chevronLeft" className="h-4 w-4 -rotate-90 text-sand-500 transition group-open:rotate-90" />
              </summary>
              <table className="w-full border-t border-sand-200 text-left text-xs">
                <tbody>
                  {result.byProperty.map((p) => (
                    <tr key={p.property_id ?? "none"} className="border-b border-sand-100 last:border-0">
                      <td className="px-3 py-1.5 font-medium text-olive-800">{p.name}</td>
                      <td className="tabular px-3 py-1.5 text-right">{rupees(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {result && result.warnings.length > 0 && (
            <ul className={`${ui.alertWarning} list-disc space-y-0.5 pl-5 text-xs`}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
        </aside>
      </div>

      {/* ---------- every rate with its GST, to check the quote and correct a price ---------- */}
      {result && detail.length > 0 && (
        <details className={`${ui.card} group`} open={editedCount > 0}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold text-olive-800">
            <span className="flex-1">Detailed price check (internal)</span>
            {editedCount > 0 && <span className="rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-semibold text-olive-800 ring-1 ring-gold-200">{editedCount} corrected by hand</span>}
            <Icon name="chevronLeft" className="h-4 w-4 -rotate-90 text-sand-500 transition group-open:rotate-90" />
          </summary>
          <div className="border-t border-sand-200">
            <p className="px-4 py-2 text-xs text-sand-500">
              Every rate in this quote with its GST %. If a rate is not right, type the correct amount (incl. GST) in the last column; it is used for this quote only. Fix master data for future quotes.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="bg-sand-100 font-semibold uppercase tracking-wide text-sand-500">
                    {!plan.dateless && <th className="px-3 py-2">Date</th>}
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Before GST</th>
                    <th className="px-3 py-2 text-right">GST %</th>
                    <th className="px-3 py-2 text-right">GST</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((r, k) => (
                    <tr key={`${r.lkey ?? r.label}-${k}`} className={`border-t border-sand-100 ${r.edited ? "bg-gold-50" : ""}`}>
                      {!plan.dateless && <td className="whitespace-nowrap px-3 py-1.5 text-sand-500">{r.date ? fmtDate(r.date) : "-"}</td>}
                      <td className="px-3 py-1.5 text-olive-800">
                        {r.label}
                        {r.manual && <span className="ml-1 text-[10px] font-semibold uppercase text-sand-500">typed</span>}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">{r.quantity}</td>
                      <td className="tabular px-3 py-1.5 text-right">{rupees(r.net)}</td>
                      <td className="tabular px-3 py-1.5 text-right">{r.gstPct != null ? `${r.gstPct}%` : "-"}</td>
                      <td className="tabular px-3 py-1.5 text-right">{rupees(r.gst)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {r.lkey && !r.manual ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              key={`${r.lkey}-${r.amount}`}
                              type="number"
                              min={0}
                              className={`tabular w-24 rounded border px-1.5 py-0.5 text-right text-xs ${r.edited ? "border-gold-400 bg-white font-semibold" : "border-sand-200"}`}
                              defaultValue={r.amount}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (e.target.value === "" || !Number.isFinite(v)) return setLinePrice(r.lkey!, null);
                                if (Math.round(v) !== r.amount) setLinePrice(r.lkey!, v);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              aria-label={`Amount for ${r.label}`}
                            />
                            {r.edited && (
                              <button type="button" className="rounded p-0.5 text-sand-500 hover:text-error" onClick={() => setLinePrice(r.lkey!, null)} title="Back to the master-data rate" aria-label="Undo the correction">
                                <Icon name="x" className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="tabular">{rupees(r.amount)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-sand-300 font-semibold text-olive-800">
                    <td className="px-3 py-2" colSpan={plan.dateless ? 5 : 6}>Total</td>
                    <td className="tabular px-3 py-2 text-right">{rupees(result.totals.grand)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {editedCount > 0 && (
              <div className="px-4 py-2">
                <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={() => setPlan((p) => ({ ...p, line_prices: {} }))}>
                  Undo all corrections
                </button>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
