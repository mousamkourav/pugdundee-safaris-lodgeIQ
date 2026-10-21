"use client";

import { useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { dayName } from "@/lib/sales/pricing/dates";
import { describe } from "@/lib/sales/plan/planner";
import { closureFor } from "@/lib/sales/pricing/engine";
import type { PriceResult } from "@/lib/sales/pricing/types";
import type { BuilderContext, DaySafari, Plan, PlanDay, PlanItem } from "@/lib/sales/plan/types";

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
  return [f.airline && f.number ? `${f.airline} ${f.number}` : f.airline || f.number, f.time && `departs ${f.time}`, f.pnr && `PNR ${f.pnr}`].filter(Boolean).join(" \u00b7 ");
}

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
  const [flight, setFlight] = useState({ from: "", to: "", airline: "", number: "", time: "", pnr: "" });
  const [search, setSearch] = useState("");

  const lodgeName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const locName = (id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "?";
  const parkLodges = new Set(plan.stops.map((s) => s.property_id));
  // Experiences: the same one at several lodges (bush dinner, nature walk, cycling) is a
  // Pugdundee experience and shown once; one that exists at a single lodge is labelled
  // with it. Naturalists are a tick on each safari, so they are not listed here.
  const addonGroups = (() => {
    const byName = new Map<string, typeof ctx.pricing.addons>();
    for (const a of ctx.pricing.addons) {
      if (a.active === false || /naturalist/i.test(a.name)) continue;
      const k = normName(a.name);
      byName.set(k, [...(byName.get(k) ?? []), a]);
    }
    const groups = [...byName.entries()].map(([key, entries]) => {
      const shared = entries.length > 1 || entries.some((e) => !e.property_id);
      const rates = entries.map((e) => e.rate);
      return { key, name: entries[0].name, entries, shared, lodgeId: shared ? null : entries[0].property_id, min: Math.min(...rates), max: Math.max(...rates), unit: entries[0].pricing_unit };
    });
    return groups
      .filter((g) => g.shared || (g.lodgeId && parkLodges.has(g.lodgeId)))
      .filter((g) => !search || g.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => Number(b.shared) - Number(a.shared) || lodgeName(a.lodgeId).localeCompare(lodgeName(b.lodgeId)) || a.name.localeCompare(b.name));
  })();
  type AddonGroup = (typeof addonGroups)[number];
  // The add-on for a given day: that day's lodge's own, else the general one, else any.
  const addonFor = (g: AddonGroup, dayIndex: number) => {
    const lodge = plan.days[dayIndex]?.property_id ?? null;
    return g.entries.find((e) => e.property_id === lodge) ?? g.entries.find((e) => !e.property_id) ?? g.entries[0];
  };
  const linePrice = (date: string, title: string) => result?.lines.find((l) => l.date === date && l.kind === "addon" && l.description === title)?.amount;

  // ---- day edits
  const setDay = (i: number, fn: (d: PlanDay) => PlanDay) => setPlan((p) => ({ ...p, days: p.days.map((d, j) => (j === i ? fn(d) : d)) }));

  function setSafari(i: number, session: DaySafari["session"], zone: "" | DaySafari["zone"]) {
    const day = plan.days[i];
    const safaris = day.safaris.filter((s) => s.session !== session);
    if (zone) safaris.push({ session, zone });
    safaris.sort((a, b) => (a.session === b.session ? 0 : a.session === "morning" ? -1 : 1));
    let kind = day.kind;
    if (kind === "safari" || kind === "leisure") kind = safaris.length ? "safari" : "leisure";
    const autoText = describe(ctx, day, plan.vehicle_type).text;
    const next: PlanDay = { ...day, safaris, kind };
    setDay(i, () => (day.text === autoText ? describe(ctx, next, plan.vehicle_type) : next));
  }

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
      const it = p.days[from]?.items.find((x) => x.id === id);
      if (!it) return p;
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
      const f = { from: flight.from.trim(), to: flight.to.trim(), airline: flight.airline.trim(), number: flight.number.trim(), time: flight.time.trim(), pnr: flight.pnr.trim() };
      return { type: "flight", title: `Flight ${f.from} to ${f.to}`, detail: custom.detail.trim(), price: Number.isFinite(price) && price > 0 ? Math.round(price) : null, addon_id: null, qty: null, flight: f };
    }
    const title = custom.title.trim();
    if (!title) return null;
    return { type: custom.type, title, detail: custom.detail.trim(), price: Number.isFinite(price) && price > 0 ? Math.round(price) : null, addon_id: null, qty: null };
  };
  const addonItem = (a: (typeof ctx.pricing.addons)[number]): Omit<PlanItem, "id"> => ({ type: "addon", title: a.name, detail: "", price: null, addon_id: a.id, qty: null });

  const stillNeeded = (result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined);

  return (
    <div className="space-y-4">
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
                    <span className="text-xs uppercase tracking-wide text-sand-500">{dayName(d.date)} {fmtDate(d.date)}</span>
                  </span>
                  <span className="truncate text-xs text-sand-500">{d.property_id ? lodgeName(d.property_id) : "Departure"}</span>
                </button>

                <ul className="divide-y divide-sand-100 text-sm">
                  {d.notes.map((n, k) => (
                    <li key={`n${k}`} className="flex gap-2 px-3 py-1.5 text-xs text-warning">
                      <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {n}
                    </li>
                  ))}
                  {d.transfer && (
                    <li className="flex items-center gap-2 px-3 py-1.5">
                      <Icon name="car" className="h-4 w-4 shrink-0 text-sand-500" />
                      <span className="flex-1 truncate">{locName(d.transfer.from_location_id)} to {locName(d.transfer.to_location_id)}</span>
                    </li>
                  )}
                  {d.park_id && (
                    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                      <Icon name="route" className="h-4 w-4 shrink-0 text-sand-500" />
                      {(["morning", "afternoon"] as const).map((session) => {
                        const closedCore = !!closureFor(ctx.pricing, d.park_id!, "core", session, d.date);
                        const closedBuffer = !!closureFor(ctx.pricing, d.park_id!, "buffer", session, d.date);
                        const value = d.safaris.find((s) => s.session === session)?.zone ?? "";
                        const onClosed = (value === "core" && closedCore) || (value === "buffer" && closedBuffer);
                        const safari = d.safaris.find((s) => s.session === session);
                        // Closed times are not offered at all (only shown if an older plan already has one).
                        if (closedCore && closedBuffer && !value) {
                          return (
                            <span key={session} className="text-xs text-sand-400">
                              {session === "morning" ? "Morning" : "Evening"}: park closed
                            </span>
                          );
                        }
                        return (
                          <span key={session} className="flex items-center gap-1.5 text-xs text-sand-600">
                            <label className="flex items-center gap-1.5">
                              {session === "morning" ? "Morning" : "Evening"}
                              <select
                                className={`rounded-md border bg-white px-1.5 py-0.5 text-xs ${onClosed ? "border-error text-error" : "border-sand-300"}`}
                                value={value}
                                onChange={(e) => setSafari(i, session, e.target.value as "" | "core" | "buffer")}
                              >
                                <option value="">No safari</option>
                                {(!closedCore || value === "core") && <option value="core">{closedCore ? "Core (closed)" : "Core"}</option>}
                                {(!closedBuffer || value === "buffer") && <option value="buffer">{closedBuffer ? "Buffer (closed)" : "Buffer"}</option>}
                              </select>
                            </label>
                            {safari && (
                              <label className="flex items-center gap-1 rounded-md bg-sand-50 px-1.5 py-0.5" title="Accompanying naturalist on this safari">
                                <input type="checkbox" className="h-3.5 w-3.5" checked={!!safari.naturalist} onChange={(e) => setNaturalist(i, session, e.target.checked)} />
                                Naturalist
                              </label>
                            )}
                          </span>
                        );
                      })}
                    </li>
                  )}
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
                          {flightSummary(it.flight) || "Subject to availability"}
                        </span>
                      )}
                      {it.addon_id ? (
                        <span className="tabular shrink-0 text-xs text-sand-600">{linePrice(d.date, it.title) !== undefined ? rupees(linePrice(d.date, it.title)!) : "-"}</span>
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
                      const header = k === 0 || addonGroups[k - 1].shared !== g.shared || addonGroups[k - 1].lodgeId !== g.lodgeId;
                      return (
                        <li key={g.key}>
                          {header && (
                            <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-wide text-sand-500 first:mt-0">
                              {g.shared ? "Pugdundee experiences (all lodges)" : `Only at ${lodgeName(g.lodgeId)}`}
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
                                {g.min === g.max ? rupees(g.min) : `from ${rupees(g.min)}`} {g.unit.replace("_", " ")} + GST
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
                    <input className={ui.inputSm} list="lq-airports" placeholder="From, e.g. Delhi" value={flight.from} onChange={(e) => setFlight((f) => ({ ...f, from: e.target.value }))} aria-label="Flight from" />
                    <input className={ui.inputSm} list="lq-airports" placeholder="To, e.g. Jabalpur" value={flight.to} onChange={(e) => setFlight((f) => ({ ...f, to: e.target.value }))} aria-label="Flight to" />
                    <input className={ui.inputSm} placeholder="Airline" value={flight.airline} onChange={(e) => setFlight((f) => ({ ...f, airline: e.target.value }))} aria-label="Airline" />
                    <input className={ui.inputSm} placeholder="Flight no." value={flight.number} onChange={(e) => setFlight((f) => ({ ...f, number: e.target.value }))} aria-label="Flight number" />
                    <input className={ui.inputSm} type="time" value={flight.time} onChange={(e) => setFlight((f) => ({ ...f, time: e.target.value }))} aria-label="Departure time" />
                    <input className={ui.inputSm} placeholder="PNR (once booked)" value={flight.pnr} onChange={(e) => setFlight((f) => ({ ...f, pnr: e.target.value }))} aria-label="PNR" />
                    <p className="col-span-2 text-[11px] text-sand-500">Without a PNR the guest sees: subject to availability and fares at the time of booking.</p>
                  </div>
                ) : (
                  <input className={ui.inputSm} placeholder="Name, e.g. Village walk, Taj Hotel Jabalpur" value={custom.title} onChange={(e) => setCustom((c) => ({ ...c, title: e.target.value }))} aria-label="Item name" />
                )}
                <input className={ui.inputSm} placeholder="Details for the guest (optional)" value={custom.detail} onChange={(e) => setCustom((c) => ({ ...c, detail: e.target.value }))} aria-label="Item details" />
                <input
                  className={`${ui.inputSm} tabular`}
                  type="number"
                  min={0}
                  placeholder="Price in Rs, incl. tax (empty = no charge)"
                  value={custom.price}
                  onChange={(e) => setCustom((c) => ({ ...c, price: e.target.value }))}
                  aria-label="Item price"
                />
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
                          setFlight({ from: "", to: "", airline: "", number: "", time: "", pnr: "" });
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

          {/* ---------- price adjustments (folded away) ---------- */}
          <details className={`${ui.card} group`}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-olive-800">
              Discount, offers, markup, currency
              {plan.discount && plan.discount.pct > 0 && <span className="ml-auto mr-2 rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-semibold text-olive-700">{plan.discount.pct}% off</span>}
              <Icon name="chevronLeft" className="h-4 w-4 -rotate-90 text-sand-500 transition group-open:rotate-90" />
            </summary>
            <div className="space-y-3 border-t border-sand-200 p-3 text-sm">
              <div className="space-y-2 rounded-lg border border-sand-200 p-2.5">
                <p className={ui.label}>Discount</p>
                <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <label className="block">
                    <span className="sr-only">Discount %</span>
                    <div className="flex items-center gap-1">
                      <input
                        className={ui.inputSm}
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
                      <span className="text-sm text-sand-500">%</span>
                    </div>
                  </label>
                  <select
                    className={`${ui.select} w-full !py-2 text-xs`}
                    disabled={!plan.discount}
                    value={plan.discount?.scope ?? "lodges"}
                    onChange={(e) => setPlan((p) => (p.discount ? { ...p, discount: { ...p.discount, scope: e.target.value as "lodges" | "all" } } : p))}
                    aria-label="Discount applies to"
                  >
                    <option value="lodges">on accommodation at our lodges</option>
                    <option value="all">on the whole itinerary</option>
                  </select>
                </div>
                {plan.discount && (
                  <label className="block">
                    <span className={ui.label}>Reason (internal) <span className="text-error">*</span></span>
                    <input
                      className={`${ui.inputSm} ${!plan.discount.reason.trim() ? "!border-error" : ""}`}
                      value={plan.discount.reason}
                      onChange={(e) => setPlan((p) => (p.discount ? { ...p, discount: { ...p.discount, reason: e.target.value } } : p))}
                      placeholder="e.g. Repeat guest, agent rate, long stay"
                    />
                    <span className="mt-1 block text-[11px] text-sand-500">Not shown to the guest.</span>
                  </label>
                )}
              </div>
              {ctx.pricing.offers.length > 0 && (
                <div className="space-y-1">
                  <p className={ui.label}>Offers</p>
                  {ctx.pricing.offers.map((o) => (
                    <label key={o.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={plan.offer_ids.includes(o.id)}
                        onChange={(e) => setPlan((p) => ({ ...p, offer_ids: e.target.checked ? [...p.offer_ids, o.id] : p.offer_ids.filter((x) => x !== o.id) }))}
                      />
                      {o.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
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
                  <span className={ui.label}>Currency</span>
                  <select className={`${ui.select} w-full !py-2`} value={plan.currency} onChange={(e) => setPlan((p) => ({ ...p, currency: e.target.value as "INR" | "USD" }))}>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
              </div>
              {plan.currency === "USD" && !ctx.pricing.settings.fx?.USD && <p className="text-xs text-error">Set the USD rate in Sales settings first.</p>}
              <div className="grid grid-cols-[6rem_1fr] gap-2">
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
                    placeholder="e.g. Repeat guest"
                  />
                </label>
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
    </div>
  );
}
