"use client";

import { ui, Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { dayName } from "@/lib/sales/pricing/dates";
import { describe } from "@/lib/sales/plan/planner";
import type { PriceResult } from "@/lib/sales/pricing/types";
import type { BuilderContext, DaySafari, Plan, PlanDay } from "@/lib/sales/plan/types";
import { Field } from "./field";

type SetPlan = (u: (p: Plan) => Plan) => void;

export function PlanStep({
  plan,
  setPlan,
  ctx,
  result,
  onDayEdited,
}: {
  plan: Plan;
  setPlan: SetPlan;
  ctx: BuilderContext;
  result: PriceResult | null;
  onDayEdited: () => void;
}) {
  const lodgeName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const locName = (id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "?";

  function setDay(i: number, next: PlanDay, edited = true) {
    setPlan((p) => ({ ...p, days: p.days.map((d, j) => (j === i ? next : d)) }));
    if (edited) onDayEdited();
  }

  function setSafari(i: number, session: DaySafari["session"], zone: "" | DaySafari["zone"]) {
    const day = plan.days[i];
    const safaris = day.safaris.filter((s) => s.session !== session);
    if (zone) safaris.push({ session, zone });
    safaris.sort((a, b) => (a.session === b.session ? 0 : a.session === "morning" ? -1 : 1));
    let kind = day.kind;
    if (kind === "safari" || kind === "leisure") kind = safaris.length ? "safari" : "leisure";
    const autoText = describe(ctx, day, plan.vehicle_type).text;
    const next: PlanDay = { ...day, safaris, kind };
    // Rewrite the day text only if it has not been edited by hand.
    setDay(i, day.text === autoText ? describe(ctx, next, plan.vehicle_type) : next, false);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h2 className="text-lg">Day by day</h2>
        {plan.days.map((d, i) => (
          <div key={d.date + i} className={`${ui.card} space-y-3 p-4 sm:p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-olive-50 font-display font-semibold text-olive-600">{i + 1}</span>
                <div>
                  <p className="font-display font-semibold text-olive-800">{fmtDate(d.date)} ({dayName(d.date)})</p>
                  <p className="text-sm text-sand-500">{d.property_id ? lodgeName(d.property_id) : "Departure"}</p>
                </div>
              </div>
              <Badge tone="neutral">{d.kind}</Badge>
            </div>
            {d.notes.map((n, k) => (
              <p key={k} className={`${ui.alertWarning} flex gap-2`}>
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                {n}
              </p>
            ))}
            {d.transfer && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg bg-sand-50 p-2.5 text-sm">
                <Icon name="car" className="h-4 w-4 text-sand-500" />
                {locName(d.transfer.from_location_id)} to {locName(d.transfer.to_location_id)}
              </p>
            )}
            {d.park_id && (
              <div className="grid gap-2 sm:grid-cols-2">
                {(["morning", "afternoon"] as const).map((session) => (
                  <label key={session} className="flex items-center justify-between gap-3 rounded-lg border border-sand-200 px-3 py-2 text-sm">
                    <span className="font-medium text-olive-800">{session === "morning" ? "Morning safari" : "Evening safari"}</span>
                    <select className={`${ui.select} !py-1.5 text-xs`} value={d.safaris.find((s) => s.session === session)?.zone ?? ""} onChange={(e) => setSafari(i, session, e.target.value as "" | "core" | "buffer")}>
                      <option value="">None</option>
                      <option value="core">Core zone</option>
                      <option value="buffer">Buffer zone</option>
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        <p className="text-xs text-sand-500">Day titles and texts can be edited on the Final draft step.</p>
      </section>

      <section className={`${ui.card} grid gap-4 p-4 sm:grid-cols-2 sm:p-5`}>
        <h2 className="text-lg sm:col-span-2">Price adjustments</h2>
        <Field label="Offers" wide hint={ctx.pricing.offers.length ? "Offers that do not apply to this trip are skipped with a note." : "No active offers."}>
          <div className="grid gap-2 sm:grid-cols-2">
            {ctx.pricing.offers.map((o) => (
              <label key={o.id} className="flex items-center gap-2 rounded-lg border border-sand-200 p-2.5 text-sm">
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
        </Field>
        <Field label="Markup %" hint={`Empty = default (${ctx.pricing.settings.markup_pct ?? 0}%).`}>
          <input
            className={ui.inputSm}
            type="number"
            step="any"
            value={plan.markup_pct ?? ""}
            onChange={(e) => setPlan((p) => ({ ...p, markup_pct: e.target.value === "" ? null : Math.max(-50, Math.min(200, Number(e.target.value))) }))}
          />
        </Field>
        <Field label="Quote currency" error={plan.currency === "USD" && !ctx.pricing.settings.fx?.USD ? "Set the USD rate in Sales settings first." : null}>
          <select className={`${ui.select} w-full`} value={plan.currency} onChange={(e) => setPlan((p) => ({ ...p, currency: e.target.value as "INR" | "USD" }))}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Manual adjustment (Rs)" hint="Negative for a discount, e.g. -5000.">
          <input
            className={ui.inputSm}
            type="number"
            value={plan.adjustment?.amount ?? ""}
            onChange={(e) => {
              const amount = Number(e.target.value);
              setPlan((p) => ({ ...p, adjustment: e.target.value === "" || !amount ? null : { amount, reason: p.adjustment?.reason ?? "" } }));
            }}
          />
        </Field>
        <Field label="Reason for adjustment" required={!!plan.adjustment} error={plan.adjustment && !plan.adjustment.reason.trim() ? "A reason is needed for an adjustment." : null}>
          <input
            className={ui.inputSm}
            disabled={!plan.adjustment}
            value={plan.adjustment?.reason ?? ""}
            onChange={(e) => setPlan((p) => (p.adjustment ? { ...p, adjustment: { ...p.adjustment, reason: e.target.value } } : p))}
            placeholder="e.g. Repeat guest goodwill"
          />
        </Field>
      </section>

      {result && (
        <>
          {result.warnings.length > 0 && <ul className={`${ui.alertWarning} list-disc space-y-0.5 pl-6`}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <section className={`${ui.card} overflow-hidden`}>
            <div className="border-b border-sand-200 px-5 py-3"><h2 className="text-lg">Cost by lodge (internal)</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                    <th className="px-4 py-2.5">Lodge</th>
                    <th className="px-4 py-2.5 text-right">Rooms</th>
                    <th className="px-4 py-2.5 text-right">Safaris</th>
                    <th className="px-4 py-2.5 text-right">Transfers</th>
                    <th className="px-4 py-2.5 text-right">Add-ons</th>
                    <th className="px-4 py-2.5 text-right">Discount</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.byProperty.map((p) => (
                    <tr key={p.property_id ?? "none"} className="border-t border-sand-200">
                      <td className="px-4 py-2.5 font-medium text-olive-800">{p.name}</td>
                      <td className="tabular px-4 py-2.5 text-right">{rupees(p.room)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{rupees(p.safari)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{rupees(p.transfer)}</td>
                      <td className="tabular px-4 py-2.5 text-right">{p.addon ? rupees(p.addon) : "-"}</td>
                      <td className="tabular px-4 py-2.5 text-right">{p.discount ? rupees(p.discount) : "-"}</td>
                      <td className="tabular px-4 py-2.5 text-right font-semibold">{rupees(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
