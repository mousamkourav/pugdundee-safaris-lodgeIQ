"use client";

import { useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { dayName } from "@/lib/sales/pricing/dates";
import { describe } from "@/lib/sales/plan/planner";
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
};
const TYPE_ICON: Record<PlanItem["type"], string> = { addon: "plus", activity: "route", hotel: "building", transfer: "car", meal: "wine", note: "fileText" };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

type DragData = { kind: "new"; item: Omit<PlanItem, "id"> } | { kind: "move"; id: string; from: number };

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
  const [search, setSearch] = useState("");

  const lodgeName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const locName = (id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "?";
  const parkLodges = new Set(plan.stops.map((s) => s.property_id));
  const addons = ctx.pricing.addons
    .filter((a) => !a.property_id || parkLodges.has(a.property_id))
    .filter((a) => !search || a.name.toLowerCase().includes(search.toLowerCase()));
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
      if (data.kind === "new") addItem(dayIndex, data.item);
      else moveItem(data.id, data.from, dayIndex);
      setTargetDay(dayIndex);
    } catch {
      /* not one of ours */
    }
  };

  const customItem = (): Omit<PlanItem, "id"> | null => {
    const title = custom.title.trim();
    if (!title) return null;
    const price = Number(custom.price);
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
                className={`rounded-xl border bg-white transition ${overDay === i ? "border-olive-600 ring-2 ring-olive-200" : isTarget ? "border-olive-300" : "border-sand-200"}`}
              >
                <button type="button" onClick={() => setTargetDay(i)} className="flex w-full items-center justify-between gap-2 border-b border-sand-100 px-3 py-2 text-left">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-olive-700">Day {i + 1}</span>
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
                      {(["morning", "afternoon"] as const).map((session) => (
                        <label key={session} className="flex items-center gap-1.5 text-xs text-sand-600">
                          {session === "morning" ? "Morning" : "Evening"}
                          <select
                            className="rounded-md border border-sand-300 bg-white px-1.5 py-0.5 text-xs"
                            value={d.safaris.find((s) => s.session === session)?.zone ?? ""}
                            onChange={(e) => setSafari(i, session, e.target.value as "" | "core" | "buffer")}
                          >
                            <option value="">No safari</option>
                            <option value="core">Core</option>
                            <option value="buffer">Buffer</option>
                          </select>
                        </label>
                      ))}
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
        <aside className="space-y-2 xl:sticky xl:top-24 xl:self-start" aria-label="Add items">
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
                {addons.length === 0 ? (
                  <p className="py-4 text-center text-xs text-sand-500">No add-ons for these lodges. Use Custom item, or add them in Master data.</p>
                ) : (
                  <ul className="max-h-[420px] space-y-1.5 overflow-y-auto">
                    {addons.map((a) => (
                      <li
                        key={a.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, { kind: "new", item: addonItem(a) })}
                        className="flex cursor-grab items-center gap-2 rounded-lg border border-sand-200 px-2.5 py-1.5 hover:border-olive-300 hover:bg-olive-50/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-olive-800">{a.name}</span>
                          <span className="block truncate text-[11px] text-sand-500">
                            {rupees(a.rate)} {a.pricing_unit.replace("_", " ")}
                            {a.property_id ? ` \u00b7 ${lodgeName(a.property_id)}` : ""}
                          </span>
                        </span>
                        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm} !min-h-7 shrink-0 !px-2`} onClick={() => addItem(targetDay, addonItem(a))}>
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="space-y-2 p-3">
                <select className={`${ui.select} w-full !py-1.5 text-sm`} value={custom.type} onChange={(e) => setCustom((c) => ({ ...c, type: e.target.value as PlanItem["type"] }))} aria-label="Item type">
                  {(["activity", "hotel", "transfer", "meal", "note"] as const).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
                <input className={ui.inputSm} placeholder="Name, e.g. Village walk, Taj Hotel Jabalpur" value={custom.title} onChange={(e) => setCustom((c) => ({ ...c, title: e.target.value }))} aria-label="Item name" />
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
              Offers, markup, currency
              <Icon name="chevronLeft" className="h-4 w-4 -rotate-90 text-sand-500 transition group-open:rotate-90" />
            </summary>
            <div className="space-y-3 border-t border-sand-200 p-3 text-sm">
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
