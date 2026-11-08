"use client";

// Group quote, Trip step: the group's details the costing needs, asked while the trip is filled in.
import { ui } from "@/components/ui";
import { GROUP_CURRENCIES, GROUP_CURRENCY_NAME, defaultGroup, groupCurrency, rowFor, type GroupCurrency, type GroupSettings } from "@/lib/sales/group/costing";
import type { Plan } from "@/lib/sales/plan/types";

const num = (v: string) => (v === "" ? 0 : Number(v));

export function GroupDetails({ plan, setPlan }: { plan: Plan; setPlan: (u: (p: Plan) => Plan) => void }) {
  const g = plan.group ?? defaultGroup();
  const cur = groupCurrency(g);
  const set = (x: Partial<GroupSettings>) => {
    const next = { ...g, ...x };
    // the first row of the ladder follows the group's size
    const rows = [...next.rows];
    if (rows.length && (x.paying != null || x.tls != null || x.per_jeep != null || x.per_vehicle != null)) rows[0] = { ...rowFor(next, next.paying, next.tls), sell_usd: rows[0].sell_usd ?? null };
    // the trip is planned (rooms, jeeps) for the paying guests
    setPlan((p) => ({ ...p, group: { ...next, rows }, guest: { ...p.guest, adults: next.paying, children: [], rooms: Math.ceil(next.paying / 2) } }));
  };
  const field = (label: string, hint: string, el: React.ReactNode) => (
    <label className="block">
      <span className={ui.label}>{label}</span>
      {el}
      <span className="mt-1 block text-xs text-sand-500">{hint}</span>
    </label>
  );
  return (
    <section className={`${ui.card} space-y-4 p-5`} aria-label="Group details">
      <div>
        <h2 className="text-lg">Group details</h2>
        <p className="text-sm text-sand-500">For the costing sheet and the price by group size (Plan & price). All of it can be changed later.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {field("Paying guests", "The group size the trip is planned for", <input className={ui.input} type="number" min={1} max={60} value={g.paying} onChange={(e) => set({ paying: Math.max(1, num(e.target.value)) })} />)}
        {field("Tour leaders", "Travelling with the group (0 = none)", <input className={ui.input} type="number" min={0} max={6} value={g.tls} onChange={(e) => set({ tls: Math.max(0, num(e.target.value)) })} />)}
        {field(
          "Tour leaders' rooms",
          "Two tour leaders can share a double",
          <select className={`${ui.select} w-full`} value={g.tl_room} onChange={(e) => set({ tl_room: e.target.value === "share" ? "share" : "single" })}>
            <option value="single">A single room each</option>
            <option value="share">Two share a double</option>
          </select>
        )}
      </div>
      {g.tls > 0 && (
        <fieldset className="space-y-2">
          <legend className={ui.label}>Tour leaders&apos; cost (rooms, flights, outstation hotels, per-person items)</legend>
          {(
            [
              ["divided", "Divided among the paying guests"],
              ["own_lodges_free", "Free at our own lodges; the rest (flights, transport share, outstation hotels) divided among the guests"],
              ["free", "Free (not charged to the group)"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-start gap-2 text-sm text-sand-700">
              <input type="radio" name="tl_cost" className="mt-1 h-4 w-4 accent-olive-600" checked={g.tl_cost === v} onChange={() => set({ tl_cost: v })} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {field("Guests in one jeep (safari)", "Jeeps = paying guests / this (edit per group size later)", <input className={ui.input} type="number" min={1} max={6} value={g.per_jeep} onChange={(e) => set({ per_jeep: Math.max(1, num(e.target.value)) })} />)}
        {field("People in one vehicle (transfers)", "Guests and tour leaders together", <input className={ui.input} type="number" min={1} max={12} value={g.per_vehicle} onChange={(e) => set({ per_vehicle: Math.max(1, num(e.target.value)) })} />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {field(
          "Quote in",
          "The tour operator's currency (an Indian group: rupees)",
          <select
            aria-label="Quote currency"
            className={`${ui.select} w-full`}
            value={cur}
            onChange={(e) => {
              const c = e.target.value as GroupCurrency;
              // a new currency: its own rate and rounding (a rate typed for another currency is not kept)
              set({ currency: c, fx: c === cur ? g.fx : null, round_to: c === "INR" ? 500 : 50 });
            }}
          >
            {GROUP_CURRENCIES.map((c) => <option key={c} value={c}>{c} - {GROUP_CURRENCY_NAME[c]}</option>)}
          </select>
        )}
        {cur !== "INR" &&
          field(
            `${GROUP_CURRENCY_NAME[cur]} rate`,
            `Rupees per 1 ${cur}, typed for this quote`,
            <input aria-label="Exchange rate" className={ui.input} type="number" min={0} step="0.01" value={g.fx ?? ""} placeholder="e.g. 85.50" onChange={(e) => set({ fx: e.target.value === "" ? null : num(e.target.value) })} />
          )}
      </div>
    </section>
  );
}
