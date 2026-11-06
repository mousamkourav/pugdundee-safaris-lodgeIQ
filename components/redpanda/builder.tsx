"use client";

// The Red Panda quote builder: guest, dates, airports, the hotel near Bagdogra, extras, then the
// price at once (the same pure pricing the server runs again when saving).
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { priceRedPanda, MARKET_LABEL, standardRooms, guestCount } from "@/lib/redpanda/pricing";
import { saveRpQuote } from "@/app/(dashboard)/red-panda/actions";
import type { AirportCode, RpMaster, RpPlan } from "@/lib/redpanda/types";

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmt = (d: string | null) => (d ? DATE.format(new Date(`${d}T00:00:00Z`)) : "-");

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={ui.label}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-sand-500">{hint}</span>}
    </label>
  );
}

export function RedPandaBuilder({ master, initial, queryId, queryNo, status }: { master: RpMaster; initial: RpPlan; queryId: string | null; queryNo: string | null; status: string | null }) {
  const router = useRouter();
  const [plan, setPlan] = useState<RpPlan>(initial);
  const [msg, setMsg] = useState<{ error?: string; problems?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const price = useMemo(() => priceRedPanda(plan, master), [plan, master]);
  const s = master.settings;
  const set = (p: Partial<RpPlan>) => setPlan((x) => ({ ...x, ...p }));
  const setG = (g: Partial<RpPlan["guest"]>) => setPlan((x) => ({ ...x, guest: { ...x.guest, ...g } }));
  const n = guestCount(plan);
  const hotel = master.hotel;

  function save(mode: "draft" | "final") {
    setMsg(null);
    start(async () => {
      const r = await saveRpQuote(JSON.stringify(plan), queryId, mode);
      if (r.error || r.problems) {
        setMsg({ error: r.error, problems: r.problems });
        return;
      }
      router.push(`/red-panda/quotes/${r.id}`);
      router.refresh();
    });
  }

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const canDraft = !status || status === "draft";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        <section className={`${ui.card} space-y-4 p-5`}>
          <h2 className="text-lg">Guest</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Guest name">
              <input className={ui.input} value={plan.guest.name} onChange={(e) => setG({ name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Country">
              <input className={ui.input} value={plan.guest.country} onChange={(e) => setG({ country: e.target.value })} maxLength={60} placeholder="e.g. United Kingdom" />
            </Field>
            <Field label="Email">
              <input className={ui.input} type="email" value={plan.guest.email} onChange={(e) => setG({ email: e.target.value })} maxLength={160} />
            </Field>
            <Field label="Phone">
              <input className={ui.input} value={plan.guest.phone} onChange={(e) => setG({ phone: e.target.value })} maxLength={40} />
            </Field>
            <Field label="Nationality">
              <select className={`${ui.select} w-full`} value={plan.guest.nationality} onChange={(e) => setG({ nationality: e.target.value === "indian" ? "indian" : "foreign" })}>
                <option value="foreign">Foreign</option>
                <option value="indian">Indian</option>
              </select>
            </Field>
            <Field label="Booked by" hint={`Tariff: ${MARKET_LABEL[price.market]}`}>
              <select className={`${ui.select} w-full`} value={plan.guest.booked_by} onChange={(e) => setG({ booked_by: e.target.value === "agent" ? "agent" : "direct" })}>
                <option value="direct">Direct guest (B2C)</option>
                <option value="agent">Travel agent (B2B)</option>
              </select>
            </Field>
            {plan.guest.booked_by === "agent" && (
              <Field label="Agent">
                <input className={ui.input} value={plan.guest.agent_name} onChange={(e) => setG({ agent_name: e.target.value })} maxLength={120} />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Adults">
              <input className={ui.input} type="number" min={1} max={s.max_guests} value={plan.guest.adults} onChange={(e) => setG({ adults: num(e.target.value) })} />
            </Field>
            <Field label={`Children (${s.min_age}+)`} hint="Ages, comma separated. Full tariff.">
              <input
                className={ui.input}
                defaultValue={plan.guest.child_ages.join(", ")}
                onChange={(e) => setG({ child_ages: e.target.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x)) })}
                placeholder="e.g. 16, 17"
              />
            </Field>
            <Field label="Rooms" hint={`Standard for ${n}: ${standardRooms(n)} (twin beds)`}>
              <input className={ui.input} type="number" min={1} max={s.max_rooms} value={plan.guest.rooms ?? ""} placeholder={String(standardRooms(n))} onChange={(e) => setG({ rooms: e.target.value === "" ? null : num(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-sand-700">
            <input type="checkbox" checked={plan.tour_leader} onChange={(e) => set({ tour_leader: e.target.checked })} className="h-4 w-4 accent-olive-600" />
            Tour leader travelling with the group (charged up to 3 guests, complimentary from 4)
          </label>
        </section>

        <section className={`${ui.card} space-y-4 p-5`}>
          <h2 className="text-lg">Dates and airports</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Arrival (the day they land)">
              <input className={ui.input} type="date" value={plan.arrival ?? ""} onChange={(e) => set({ arrival: e.target.value || null })} />
            </Field>
            <Field label="Nights at Red Panda Outpost" hint={`Package: ${s.package_nights} nights (sometimes ${s.min_nights}); other nights pro rata`}>
              <input className={ui.input} type="number" min={s.min_nights} max={s.max_nights} value={plan.nights} onChange={(e) => set({ nights: num(e.target.value) })} />
            </Field>
            <Field label="Arrival airport">
              <select className={`${ui.select} w-full`} value={plan.arrive_airport} onChange={(e) => set({ arrive_airport: e.target.value as AirportCode })}>
                {s.airports.map((a) => (
                  <option key={a.code} value={a.code}>{a.name} ({a.hours} h)</option>
                ))}
              </select>
            </Field>
            <Field label="Departure airport">
              <select className={`${ui.select} w-full`} value={plan.depart_airport} onChange={(e) => set({ depart_airport: e.target.value as AirportCode })}>
                {s.airports.map((a) => (
                  <option key={a.code} value={a.code}>{a.name} ({a.hours} h)</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className={`${ui.card} space-y-4 p-5`}>
          <h2 className="text-lg">Hotel near Bagdogra (add-on)</h2>
          {!hotel ? (
            <p className="text-sm text-sand-500">No partner hotel &quot;{s.hotel_property}&quot; in Sales Master data.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(["hotel_before", "hotel_after"] as const).map((k) => (
                <div key={k} className="space-y-2 rounded-lg border border-sand-200 p-3">
                  <p className="text-sm font-semibold text-olive-800">{k === "hotel_before" ? "Before (on arrival)" : "After (before departure)"}</p>
                  <div className="grid grid-cols-[90px_1fr] gap-2">
                    <input className={ui.inputSm} type="number" min={0} max={5} aria-label="Nights" value={plan[k].nights} onChange={(e) => set({ [k]: { ...plan[k], nights: num(e.target.value) } } as Partial<RpPlan>)} />
                    <select className={`${ui.select} w-full py-2`} aria-label="Room" value={plan[k].room_id ?? ""} onChange={(e) => set({ [k]: { ...plan[k], room_id: e.target.value || null } } as Partial<RpPlan>)}>
                      <option value="">Room type</option>
                      {hotel.rooms.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-sand-500">Nights at {hotel.name}, with the Bagdogra Airport transfer.</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`${ui.card} space-y-4 p-5`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg">Extra items</h2>
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => set({ custom_items: [...plan.custom_items, { label: "", amount: 0, gst_pct: 5 }] })}>
              <Icon name="plus" className="h-4 w-4" /> Add item
            </button>
          </div>
          {plan.custom_items.length === 0 && <p className="text-sm text-sand-500">None. Add anything not in the package (priced by hand).</p>}
          {plan.custom_items.map((c, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_90px_auto]">
              <input className={ui.inputSm} placeholder="Item" value={c.label} onChange={(e) => set({ custom_items: plan.custom_items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className={ui.inputSm} type="number" min={0} placeholder="Amount" value={c.amount} onChange={(e) => set({ custom_items: plan.custom_items.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)) })} />
              <input className={ui.inputSm} type="number" min={0} max={28} aria-label="GST %" value={c.gst_pct} onChange={(e) => set({ custom_items: plan.custom_items.map((x, j) => (j === i ? { ...x, gst_pct: num(e.target.value) } : x)) })} />
              <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} aria-label="Remove" onClick={() => set({ custom_items: plan.custom_items.filter((_, j) => j !== i) })}>
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
          ))}
        </section>

        <section className={`${ui.card} space-y-4 p-5`}>
          <h2 className="text-lg">Price changes</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rate per person (by hand)" hint="Empty = the tariff. For a B2C rate changed for this guest.">
              <input className={ui.input} type="number" min={0} value={plan.per_pax_override ?? ""} placeholder={String(price.per_pax || "")} onChange={(e) => set({ per_pax_override: e.target.value === "" ? null : num(e.target.value) })} />
            </Field>
            <Field label="Markup %">
              <input className={ui.input} type="number" min={0} max={100} value={plan.markup_pct} onChange={(e) => set({ markup_pct: num(e.target.value) })} />
            </Field>
            <Field label="Discount (Rs, before GST)">
              <input className={ui.input} type="number" min={0} value={plan.discount} onChange={(e) => set({ discount: num(e.target.value) })} />
            </Field>
            <Field label="Adjustment (Rs, after GST; + or -)">
              <input className={ui.input} type="number" value={plan.adjustment.amount} onChange={(e) => set({ adjustment: { ...plan.adjustment, amount: num(e.target.value) } })} />
            </Field>
          </div>
          {plan.adjustment.amount !== 0 && (
            <Field label="Reason for the adjustment (internal)">
              <input className={ui.input} value={plan.adjustment.reason} maxLength={300} onChange={(e) => set({ adjustment: { ...plan.adjustment, reason: e.target.value } })} />
            </Field>
          )}
          <Field label="Internal notes (never on the guest page)">
            <textarea className={ui.input} rows={3} maxLength={2000} value={plan.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <section className={`${ui.card} p-5`}>
          <p className="eyebrow">{queryNo ? `Quote ${queryNo}` : "New quote"}</p>
          <p className="mt-1 tabular font-display text-3xl font-semibold text-olive-800">{inr(price.totals.grand)}</p>
          <p className="text-sm text-sand-500">
            {price.guests} guest{price.guests === 1 ? "" : "s"} &middot; {inr(price.perPerson)} per person &middot; {price.rooms} room{price.rooms === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-sand-500">
            {fmt(price.arrival)} to {fmt(price.departure)}
            {price.season ? ` - Tariff ${price.season}` : ""}
          </p>
          <ul className="mt-4 space-y-2 border-t border-sand-200 pt-3 text-sm">
            {price.lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium text-olive-800">{l.label}</span>
                  <span className="block text-xs text-sand-500">{l.detail}</span>
                </span>
                <span className="tabular shrink-0">{inr(l.amount)}</span>
              </li>
            ))}
            {price.totals.markup > 0 && <li className="flex justify-between"><span>Markup</span><span className="tabular">{inr(price.totals.markup)}</span></li>}
            {price.totals.discount > 0 && <li className="flex justify-between"><span>Discount</span><span className="tabular">-{inr(price.totals.discount)}</span></li>}
            <li className="flex justify-between"><span>GST {s.gst_pct}% on the package</span><span className="tabular">{inr(price.totals.package_gst)}</span></li>
            {price.lines.filter((l) => l.group !== "package" && l.gst > 0).map((l) => (
              <li key={`${l.key}-tax`} className="flex justify-between text-sand-600"><span>Tax on {l.label.split(",")[0]} ({l.gst_pct}%)</span><span className="tabular">{inr(l.gst)}</span></li>
            ))}
            {price.totals.adjustment !== 0 && <li className="flex justify-between"><span>Adjustment</span><span className="tabular">{inr(price.totals.adjustment)}</span></li>}
            <li className="flex justify-between border-t border-sand-200 pt-2 font-semibold text-olive-800"><span>Total</span><span className="tabular">{inr(price.totals.grand)}</span></li>
          </ul>
          {price.payments.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-sand-600">
              {price.payments.map((p) => (
                <li key={p.label} className="flex justify-between"><span>{p.label} ({p.pct}%), {p.due ? `by ${fmt(p.due)}` : "at booking"}</span><span className="tabular">{inr(p.amount)}</span></li>
              ))}
            </ul>
          )}
        </section>
        {price.errors.length > 0 && (
          <div className={ui.alertError}>
            <p className="font-semibold">To fix before sending</p>
            <ul className="mt-1 list-disc pl-4">{price.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {price.warnings.length > 0 && (
          <div className={ui.alertWarning}>
            <ul className="list-disc pl-4">{price.warnings.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        {msg && (
          <div className={ui.alertError} role="alert">
            {msg.error}
            {msg.problems && <ul className="mt-1 list-disc pl-4">{msg.problems.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" className={ui.btnPrimary} disabled={pending || !price.ok || !plan.guest.name.trim()} onClick={() => save("final")}>
            <Icon name="send" className="h-[18px] w-[18px]" />
            {pending ? "Saving..." : queryId && status !== "draft" ? "Save a new version" : "Save and get the guest link"}
          </button>
          {canDraft && (
            <button type="button" className={ui.btnSecondary} disabled={pending} onClick={() => save("draft")}>
              Save as draft
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
