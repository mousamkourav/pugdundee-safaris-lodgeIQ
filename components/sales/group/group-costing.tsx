"use client";

// Group quote, Plan & price: the costing sheet (one row per day, six kinds of cost from Master data,
// every cell editable) and the price by group size (the ladder), like the team's Excel.
import { useMemo } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { COST_KINDS, COST_LABEL, defaultGroup, priceGroup, rowFor, type CostKind, type GroupRow, type GroupSettings } from "@/lib/sales/group/costing";
import { costSheet } from "@/lib/sales/group/sheet";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const usd = (n: number | null) => (n == null ? "-" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const num = (v: string) => (v === "" ? 0 : Number(v));

export function GroupCosting({ plan, setPlan, ctx, today }: { plan: Plan; setPlan: (u: (p: Plan) => Plan) => void; ctx: BuilderContext; today: string }) {
  const g: GroupSettings = useMemo(() => plan.group ?? defaultGroup(), [plan.group]);
  const rows = useMemo(() => (g.rows.length ? g.rows : [rowFor(g, g.paying, g.tls)]), [g]);
  const sheet = useMemo(() => costSheet(plan, ctx, today, g), [plan, ctx, today, g]);
  const price = useMemo(() => priceGroup(sheet.days, { ...g, rows }), [sheet, g, rows]);
  const set = (x: Partial<GroupSettings>) =>
    setPlan((p) => {
      const cur = p.group ?? defaultGroup();
      return { ...p, group: { ...cur, rows: cur.rows.length ? cur.rows : [rowFor(cur, cur.paying, cur.tls)], ...x } };
    });
  const setCell = (key: string, kind: CostKind, v: string, auto: number) => {
    const cells = { ...g.cells, [key]: { ...(g.cells[key] ?? {}) } };
    if (v === "" || Number(v) === auto) delete cells[key][kind];
    else cells[key][kind] = Math.max(0, num(v));
    if (!Object.keys(cells[key]).length) delete cells[key];
    set({ cells });
  };
  const setRow = (i: number, x: Partial<GroupRow>) => set({ rows: rows.map((r, j) => (j === i ? { ...r, ...x } : r)) });
  const t = price.totals;

  return (
    <div className="space-y-6">
      <section className={`${ui.card} p-5`} aria-label="Group costing sheet">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg">Group costing sheet</h2>
            <p className="text-sm text-sand-500">From Master data, GST included. Change any figure; the Master data figure stays shown under it.</p>
            <p className="mt-1 text-xs text-sand-500">
              Each column is one unit for the day: Single / Double = one room; Per jeep = one jeep on all that day&apos;s safaris (with their naturalists); Per vehicle = one vehicle on all that day&apos;s transfers; Per person = one guest; Per group = once. The jeeps and vehicles the group needs are set by group size below.
            </p>
          </div>
          {Object.keys(g.cells).length > 0 && (
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => set({ cells: {} })}>Back to Master data figures</button>
          )}
        </div>
        {sheet.missing.length > 0 && <p className={`${ui.alertWarning} mt-3`}>No rate in Master data: {sheet.missing.join("; ")}. Type them in the sheet.</p>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                <th className="py-2 pr-2">Day</th>
                <th className="py-2 pr-2">Itinerary</th>
                <th className="py-2 pr-2">Accommodation</th>
                <th className="py-2 pr-2">Meal</th>
                {COST_KINDS.map((k) => <th key={k} className="py-2 pr-2 text-right">{COST_LABEL[k]}</th>)}
              </tr>
            </thead>
            <tbody>
              {sheet.days.map((d) => (
                <tr key={d.key} className="border-t border-sand-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-olive-800">
                    {d.n}
                    {d.date && <span className="block text-xs font-normal text-sand-500">{DATE.format(new Date(`${d.date}T00:00:00Z`))}</span>}
                  </td>
                  <td className="max-w-[220px] py-1.5 pr-2 text-sand-700">{d.title}</td>
                  <td className="py-1.5 pr-2">
                    {d.stay || "-"}
                    {d.category && <span className="block text-xs text-sand-500">{d.category}</span>}
                  </td>
                  <td className="py-1.5 pr-2">{d.meal || "-"}</td>
                  {COST_KINDS.map((k) => (
                    <td key={k} className="py-1.5 pr-2 text-right">
                      <input
                        aria-label={`Day ${d.n} ${COST_LABEL[k]}`}
                        className={`${ui.inputSm} tabular w-24 text-right ${d.edited.includes(k) ? "border-gold-400 bg-gold-50" : ""}`}
                        inputMode="numeric"
                        value={d.cost[k] || ""}
                        placeholder="0"
                        onChange={(e) => setCell(d.key, k, e.target.value, d.auto[k])}
                      />
                      {d.edited.includes(k) ? (
                        <span className="block text-[11px] text-sand-400">was {inr(d.auto[k])}</span>
                      ) : d.why?.[k] && d.cost[k] ? (
                        <span className="block max-w-24 text-[11px] leading-tight text-sand-400">{d.why[k]}</span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-sand-300 font-semibold text-olive-800">
                <td className="py-2" colSpan={4}>Total</td>
                {COST_KINDS.map((k) => <td key={k} className="tabular py-2 pr-2 text-right">{inr(t[k])}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${ui.card} space-y-4 p-5`} aria-label="Price by group size">
        <div>
          <h2 className="text-lg">Price by group size</h2>
          <p className="text-sm text-sand-500">
            Per paying guest, twin sharing = double / 2 + per person + (per jeep x jeeps + per vehicle x vehicles + per group + tour leaders) / paying guests.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className={ui.label}>US dollar rate</span>
            <input className={ui.input} type="number" min={0} step="0.01" value={g.fx ?? ""} placeholder="Rupees per dollar" onChange={(e) => set({ fx: e.target.value === "" ? null : num(e.target.value) })} />
          </label>
          <label className="block">
            <span className={ui.label}>Markup %</span>
            <input className={ui.input} type="number" min={0} max={100} value={g.markup_pct} onChange={(e) => set({ markup_pct: Math.max(0, num(e.target.value)) })} />
          </label>
          <label className="block">
            <span className={ui.label}>Round the selling price up to</span>
            <select className={`${ui.select} w-full`} value={g.round_to} onChange={(e) => set({ round_to: Number(e.target.value) })}>
              <option value={0}>$1</option>
              <option value={10}>$10</option>
              <option value={50}>$50</option>
              <option value={100}>$100</option>
            </select>
          </label>
        </div>
        {price.problems.length > 0 && <p className={ui.alertWarning}>{price.problems.join(" ")}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                <th className="py-2 pr-2">Paying</th>
                <th className="py-2 pr-2">Tour leaders</th>
                <th className="py-2 pr-2">Jeeps</th>
                <th className="py-2 pr-2">Vehicles</th>
                <th className="py-2 pr-2 text-right">Cost / guest (Rs)</th>
                <th className="py-2 pr-2 text-right">Cost / guest ($)</th>
                <th className="py-2 pr-2 text-right">Selling / guest ($)</th>
                <th className="py-2 pr-2 text-right">Margin ($)</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {price.rows.map((r, i) => (
                <tr key={i} className="border-t border-sand-100">
                  {(["paying", "tls", "jeeps", "vehicles"] as const).map((k) => (
                    <td key={k} className="py-1.5 pr-2">
                      <input aria-label={`Row ${i + 1} ${k}`} className={`${ui.inputSm} w-16`} type="number" min={k === "paying" ? 1 : 0} value={rows[i][k]} onChange={(e) => setRow(i, { [k]: Math.max(k === "paying" ? 1 : 0, num(e.target.value)) })} />
                    </td>
                  ))}
                  <td className="tabular py-1.5 pr-2 text-right">{inr(r.inr)}</td>
                  <td className="tabular py-1.5 pr-2 text-right">{usd(r.usd)}</td>
                  <td className="py-1.5 pr-2 text-right">
                    <input
                      aria-label={`Row ${i + 1} selling price`}
                      className={`${ui.inputSm} tabular w-24 text-right ${r.typed ? "border-gold-400 bg-gold-50" : ""}`}
                      type="number"
                      min={0}
                      value={rows[i].sell_usd ?? ""}
                      placeholder={r.sell != null ? String(r.sell) : ""}
                      onChange={(e) => setRow(i, { sell_usd: e.target.value === "" ? null : num(e.target.value) })}
                    />
                  </td>
                  <td className={`tabular py-1.5 pr-2 text-right ${r.margin != null && r.margin < 0 ? "text-error" : ""}`}>{usd(r.margin)}</td>
                  <td className="py-1.5 text-right">
                    {rows.length > 1 && (
                      <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} aria-label={`Remove row ${i + 1}`} onClick={() => set({ rows: rows.filter((_, j) => j !== i), booked_row: null })}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className={`${ui.btnSecondary} ${ui.btnSm}`}
          onClick={() => {
            const last = rows[rows.length - 1];
            set({ rows: [...rows, rowFor(g, last.paying + 2, last.tls)] });
          }}
        >
          <Icon name="plus" className="h-4 w-4" /> Add a group size
        </button>
        <div className="grid gap-3 rounded-lg border border-sand-200 p-4 text-sm sm:grid-cols-2">
          <p className="sm:col-span-2 text-sand-600">When the group books (for Payments): the group size and single rooms it booked. The booking is in US dollars: selling price x paying guests + single supplement x single rooms.</p>
          <label className="space-y-1">
            <span className={ui.label}>Group size booked</span>
            <select aria-label="Group size booked" className={`${ui.select} w-full`} value={g.booked_row ?? 0} onChange={(e) => set({ booked_row: Number(e.target.value) })}>
              {rows.map((r, i) => <option key={i} value={i}>{r.paying} + {r.tls}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className={ui.label}>Single rooms (guests paying the supplement)</span>
            <input aria-label="Single rooms booked" className={ui.input} type="number" min={0} max={30} value={g.singles ?? 0} onChange={(e) => set({ singles: Math.min(30, Math.max(0, Math.floor(num(e.target.value)))) })} />
          </label>
        </div>
        <div className="grid gap-3 rounded-lg bg-sand-50 p-4 text-sm sm:grid-cols-2">
          <p>
            <span className="text-sand-500">Single room supplement: </span>
            <b className="text-olive-800">Rs {inr(price.single_supplement.inr)}</b> = {usd(price.single_supplement.usd)} &rarr; sell <b>{usd(price.single_supplement.sell)}</b>
          </p>
          {price.extra_night && (
            <p>
              <span className="text-sand-500">Extra night at {price.extra_night.name} (before / after): </span>
              <b className="text-olive-800">{usd(price.extra_night.usd_sharing)}</b> per guest sharing, <b className="text-olive-800">{usd(price.extra_night.usd_single)}</b> single
            </p>
          )}
          <p className="sm:col-span-2 text-sand-600">
            Tour leaders ({g.tls}, {g.tl_room === "share" ? "two share a double" : "a single room each"}):{" "}
            {g.tl_cost === "free" ? "free, not charged to the group." : g.tl_cost === "own_lodges_free" ? "free at our own lodges; the rest divided among the paying guests." : "their rooms and per-person costs divided among the paying guests."}{" "}
            {price.rows[0] && g.tls > 0 && g.tl_cost !== "free" && <>For {price.rows[0].paying} + {price.rows[0].tls}: Rs {inr(price.rows[0].tl_inr)} in all.</>}
          </p>
        </div>
      </section>
    </div>
  );
}
