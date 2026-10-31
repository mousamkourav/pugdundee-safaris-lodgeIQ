"use client";

import { ui } from "@/components/ui";
import { paxLines } from "@/lib/sales/pricing/pax";
import { Icon } from "@/components/icons";
import { rupees, fmtDate, fmtDay } from "@/lib/sales/format";
import { defaultDraft, withEdits, type DraftInputs } from "@/lib/sales/plan/draft";
import { detailedBreakdown, priceBreakdown } from "@/lib/sales/pricing/breakdown";
import { flightSummary } from "./plan-step";
import type { PriceResult } from "@/lib/sales/pricing/types";
import type { BuilderContext, Plan, PlanDraft } from "@/lib/sales/plan/types";

type SetPlan = (u: (p: Plan) => Plan) => void;

export function draftInputs(ctx: BuilderContext): DraftInputs {
  return {
    parkNames: Object.fromEntries(ctx.pricing.parks.map((p) => [p.id, p.name])),
    lodgeNames: Object.fromEntries(ctx.properties.map((p) => [p.id, p.name])),
    blocks: ctx.content,
    cancellationSlabs: ctx.cancellation,
    closures: ctx.pricing.closures,
    today: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
  };
}

const BREAKUP_OPTIONS: { value: "none" | "summary" | "detailed"; label: string; help: string }[] = [
  { value: "none", label: "Total only", help: "Per-person price and total" },
  { value: "summary", label: "Breakup with GST", help: "By service: accommodation, safaris, transfers... and GST" },
  { value: "detailed", label: "Detailed breakup", help: "Every rate with its GST %" },
];

const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

// The guest itinerary exactly as the guest will see it, with every text
// editable in place. Edits are stored in plan.draft and plan.days.
export function FinalDraft({
  plan,
  setPlan,
  ctx,
  result,
  onDayEdited,
  nameError,
}: {
  plan: Plan;
  setPlan: SetPlan;
  ctx: BuilderContext;
  result: PriceResult | null;
  onDayEdited: () => void;
  nameError: string | null;
}) {
  const def = defaultDraft(plan, draftInputs(ctx));
  const view = withEdits(def, plan.draft);
  const setDraft = (patch: Partial<PlanDraft>) => setPlan((p) => ({ ...p, draft: { ...(p.draft ?? {}), ...patch } }));
  const resetDraft = (key: keyof PlanDraft) =>
    setPlan((p) => {
      const d = { ...(p.draft ?? {}) };
      delete d[key];
      return { ...p, draft: d };
    });
  const edited = (key: keyof PlanDraft) => plan.draft?.[key] !== undefined;
  const lodgeName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);

  // A plain function (not a nested component) so the textarea keeps focus.
  const listEditor = (k: "inclusions" | "exclusions" | "notes", label: string) => (
    <div key={k}>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-base">{label}</h3>
        {edited(k) && (
          <button type="button" className="text-xs font-semibold text-olive-600 hover:underline" onClick={() => resetDraft(k)}>
            Reset to standard text
          </button>
        )}
      </div>
      <textarea
        className={`${ui.inputSm} leading-relaxed`}
        rows={Math.max(3, view[k].length + 1)}
        defaultValue={view[k].join("\n")}
        key={`${k}-${edited(k)}-${def[k].join("|")}`}
        onBlur={(e) => {
          const next = toLines(e.target.value);
          if (next.join("\n") !== view[k].join("\n")) setDraft({ [k]: next });
        }}
        aria-label={label}
      />
      <p className="mt-1 text-xs text-sand-500">One item per line.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className={`${ui.alertSuccess} flex gap-2`}>
        <Icon name="checkCircle" className="mt-0.5 h-4 w-4 shrink-0" />
        This is what the guest will see. Click any text to edit it. Prices come from the plan and cannot be typed here.
      </p>

      {nameError && (
        <div className={`${ui.card} p-4`}>
          <label className={ui.label}>Guest name <span className="text-error">*</span></label>
          <input className={ui.inputSm} value={plan.guest.name} onChange={(e) => setPlan((p) => ({ ...p, guest: { ...p.guest, name: e.target.value } }))} autoFocus />
          <p className="mt-1 text-xs font-medium text-error">{nameError}</p>
        </div>
      )}

      <article className={`${ui.card} overflow-hidden`}>
        <header className="space-y-2 bg-olive-800 p-6 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-200">Headline and route</p>
          <input
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 font-display text-2xl font-bold text-white placeholder:text-white/50 focus:border-gold-300 focus:outline-none"
            value={plan.draft?.title ?? def.title}
            onChange={(e) => setDraft({ title: e.target.value })}
            aria-label="Itinerary title"
          />
          <input
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 font-display text-base text-gold-200 placeholder:text-white/50 focus:border-gold-300 focus:outline-none"
            value={plan.draft?.subtitle ?? def.routeLine}
            onChange={(e) => setDraft({ subtitle: e.target.value })}
            aria-label="Route line under the headline"
          />
          <p className="text-sm text-white/85">
            Prepared for {plan.guest.name || "the guest"} &middot; {plan.dateless ? "travel dates to be confirmed" : plan.days.length ? `${fmtDate(plan.days[0].date)} - ${fmtDate(plan.days[plan.days.length - 1].date)}` : ""} &middot; {plan.days.length || nights + 1} days
          </p>
        </header>

        <div className="space-y-8 p-5 sm:p-8">
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h2 className="text-lg">About this trip</h2>
              {edited("about") && <button type="button" className="text-xs font-semibold text-olive-600 hover:underline" onClick={() => resetDraft("about")}>Reset to standard text</button>}
            </div>
            <textarea className={`${ui.inputSm} leading-relaxed`} rows={3} value={view.about} onChange={(e) => setDraft({ about: e.target.value })} aria-label="About this trip" />
          </section>

          <section>
            <h2 className="text-lg">Your journey</h2>
            <ol className="mt-4 space-y-5">
              {plan.days.map((d, i) => (
                <li key={d.date + i} className="grid gap-2 sm:grid-cols-[120px_1fr]">
                  <div>
                    <p className="font-display font-semibold text-olive-800">Day {i + 1}</p>
                    {!plan.dateless && <p className="text-sm text-sand-500">{fmtDay(d.date)}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <input
                      className={`${ui.inputSm} font-semibold`}
                      value={d.title}
                      onChange={(e) => {
                        setPlan((p) => ({ ...p, days: p.days.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) }));
                        onDayEdited();
                      }}
                      aria-label={`Day ${i + 1} title`}
                    />
                    <textarea
                      className={`${ui.inputSm} leading-relaxed`}
                      rows={2}
                      value={d.text}
                      onChange={(e) => {
                        setPlan((p) => ({ ...p, days: p.days.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }));
                        onDayEdited();
                      }}
                      aria-label={`Day ${i + 1} text`}
                    />
                    {(d.items ?? []).length > 0 && (
                      <ul className="space-y-0.5 rounded-lg bg-sand-50 px-3 py-2 text-sm">
                        {d.items.map((it) => (
                          <li key={it.id}>
                            <span className="font-medium text-olive-800">{it.title}</span>
                            {it.type === "flight" && flightSummary(it.flight) && <span className="text-sand-600"> - {flightSummary(it.flight)}</span>}
                            {it.detail && <span className="text-sand-600"> - {it.detail}</span>}
                          </li>
                        ))}
                        <li className="pt-1 text-[11px] text-sand-500">Added items are shown to the guest without prices. Change them on Plan &amp; price.</li>
                      </ul>
                    )}
                    {d.property_id && plan.days.findIndex((x) => x.property_id === d.property_id) === i && (
                      <p className="text-xs text-sand-500">The guest page shows photos and the description of {lodgeName(d.property_id)} here.</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* what the guest sees about prices: the total always, the breakup as chosen */}
          {(() => {
            const mode = plan.client?.breakup ?? (plan.client?.show_breakup ? "summary" : "none");
            const setMode = (m: "none" | "summary" | "detailed") => setPlan((p) => ({ ...p, client: { show_prices: true, show_breakup: m !== "none", breakup: m } }));
            const fx = result && result.currency !== "INR" && result.fx ? result.fx : null;
            const money = (n: number) => (fx ? `${result!.currency} ${(n / fx).toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : rupees(n));
            return (
              <>
                <section className="space-y-2 rounded-xl border border-dashed border-sand-300 px-4 py-3 text-sm print:hidden">
                  <p className="font-semibold text-olive-800">Price shown to the guest</p>
                  <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Price shown to the guest">
                    {BREAKUP_OPTIONS.map((o) => (
                      <label key={o.value} className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${mode === o.value ? "border-olive-600 bg-olive-50" : "border-sand-200 hover:border-sand-300"}`}>
                        <input type="radio" name="breakup" className="mt-0.5 h-4 w-4" checked={mode === o.value} onChange={() => setMode(o.value)} />
                        <span>
                          <span className="block font-medium text-olive-800">{o.label}</span>
                          <span className="block text-xs text-sand-500">{o.help}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-sand-500">The trip quotation (per person and total) is always shown. The team always sees the full breakup on the query page and in the detailed price check.</p>
                </section>

                {result && (
                  <section className="space-y-3 rounded-xl bg-sand-100 p-5">
                    <p className="eyebrow">Trip quotation</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        {paxLines(result.perPerson, result.split, money).map((l, k) => (
                          <p key={k} className={k === 0 ? "" : "text-sm"}>
                            <span className={`tabular font-display font-semibold text-olive-800 ${k === 0 ? "text-2xl" : "text-base"}`}>{l.amount}</span>{" "}
                            <span className="text-sm text-sand-500">{l.label}</span>
                          </p>
                        ))}
                      </div>
                      <div className="sm:text-right">
                        <p className="eyebrow">Total</p>
                        <p className="tabular mt-1 font-display text-xl font-semibold text-olive-800">{money(result.totals.grand)}</p>
                      </div>
                    </div>
                    {mode === "summary" && (
                      <table className="w-full text-sm">
                        <tbody>
                          {priceBreakdown(result).rows.map((r) => (
                            <tr key={r.key} className={r.key === "gst" ? "border-t border-sand-300" : ""}>
                              <td className="py-1">{r.label}</td>
                              <td className="tabular py-1 text-right">{money(r.amount)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-sand-300 font-semibold text-olive-800">
                            <td className="py-1.5">Total including GST</td>
                            <td className="tabular py-1.5 text-right">{money(result.totals.grand)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                    {mode === "detailed" && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[480px] text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                              <th className="py-1 pr-2">Service</th>
                              <th className="py-1 pr-2 text-right">Before GST</th>
                              <th className="py-1 pr-2 text-right">GST</th>
                              <th className="py-1 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailedBreakdown(result).rows.map((r, k) => (
                              <tr key={k} className="border-t border-sand-200 align-top">
                                <td className="py-1 pr-2">
                                  {r.label}
                                  {r.date && !plan.dateless && <span className="block text-xs text-sand-500">{fmtDate(r.date)}</span>}
                                </td>
                                <td className="tabular py-1 pr-2 text-right">{money(r.net)}</td>
                                <td className="tabular py-1 pr-2 text-right">
                                  {money(r.gst)}
                                  {r.gstPct ? <span className="block text-xs text-sand-500">{r.gstPct}%</span> : null}
                                </td>
                                <td className="tabular py-1 text-right">{money(r.amount)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-sand-300 font-semibold text-olive-800">
                              <td className="py-1.5" colSpan={3}>Total including GST</td>
                              <td className="tabular py-1.5 text-right">{money(result.totals.grand)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </>
            );
          })()}

          <section className="grid gap-6 sm:grid-cols-2">
            {listEditor("inclusions", "Price includes")}
            {listEditor("exclusions", "Price does not include")}
          </section>
          {listEditor("notes", "Good to know")}

          {result && (
            <section>
              <h3 className="text-base">Payment schedule</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {result.payments.map((p, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{p.label}<span className="text-sand-500"> - {p.due ? `by ${fmtDate(p.due)}` : p.note && plan.dateless ? p.note : "to confirm the booking"}</span></span>
                    <span className="tabular">{rupees(p.amount)}</span>
                  </li>
                ))}
              </ul>
              {view.paymentTerms && <p className="mt-2 whitespace-pre-line text-sm text-sand-600">{view.paymentTerms}</p>}
            </section>
          )}
          {view.cancellation.length > 0 && (
            <section>
              <h3 className="text-base">Cancellation policy</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-sand-600">{view.cancellation.map((t, i) => <li key={i}>{t}</li>)}</ul>
              <p className="mt-1 text-xs text-sand-500">Payment and cancellation terms are the same for every quote; change them in Master data.</p>
            </section>
          )}
        </div>
      </article>
    </div>
  );
}
