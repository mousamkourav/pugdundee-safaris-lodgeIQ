"use client";

// The Red Panda quote builder, in the Safari builder's four steps: Trip (the assistant reads the
// enquiry, or fill the form), Confirm (the trip in plain words, one-click fixes), Plan & price
// (rooms, extras, price changes) and Final draft (the guest text for this quote, then save). The
// price is the same pure pricing the server runs again when saving.
import { useMemo, useState, useTransition } from "react";
import { RpChat, type RpChatMessage } from "./rp-chat";
import { applyReading, isRpConfirmed, mentionsOtherPlaces, nextQuestion, replyText, rpConfirmKey, tripSummary } from "@/lib/redpanda/assist";
import { rpDayLabel, rpGuestContent } from "@/lib/redpanda/content";
import { rpAssist } from "@/app/(dashboard)/red-panda/ai-actions";
import type { RpPending } from "@/lib/redpanda/reader";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { priceRedPanda, rpSeasons, MARKET_LABEL, standardRooms, guestCount } from "@/lib/redpanda/pricing";
import { saveRpQuote } from "@/app/(dashboard)/red-panda/actions";
import type { AirportCode, RpMaster, RpPlan } from "@/lib/redpanda/types";

const monthYear = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

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

const STEPS = ["Trip", "Confirm", "Plan & price", "Final draft"];

function Stepper({ step, canGo, go }: { step: number; canGo: (n: number) => boolean; go: (n: number) => void }) {
  return (
    <ol className={`${ui.card} flex items-center gap-2 overflow-x-auto px-3 py-2`}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <button type="button" disabled={!canGo(i)} onClick={() => go(i)} className="flex items-center gap-2 whitespace-nowrap text-sm disabled:cursor-not-allowed disabled:opacity-60">
              <span
                className={
                  "grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold " +
                  (done ? "border-olive-600 bg-olive-600 text-white" : active ? "border-olive-600 bg-white text-olive-600 ring-4 ring-olive-100" : "border-sand-300 bg-white text-sand-500")
                }
              >
                {done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
              </span>
              <span className={active || done ? "font-semibold text-olive-800" : "text-sand-500"}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={"h-px min-w-6 flex-1 " + (done ? "bg-olive-600" : "bg-sand-200")} />}
          </li>
        );
      })}
    </ol>
  );
}

const QUICK: Partial<Record<NonNullable<RpPending>, string[]>> = { nationality: ["Indian", "Foreign"], hotel_side: ["Before", "After"] };
const HELLO: RpChatMessage = {
  role: "assistant",
  text: "Paste the enquiry as it came in (email, WhatsApp, an agent's mail). I read the guests and their ages, nationality, an agent, Delhi (nights and the flight to Bagdogra), the arrival date, nights, the airports (Bagdogra or Bhadrapur), rooms, a tour leader and nights at the hotel near Bagdogra, and ask for anything missing. You can also fill the form.",
};

export function RedPandaBuilder({ master, initial, queryId, queryNo, status }: { master: RpMaster; initial: RpPlan; queryId: string | null; queryNo: string | null; status: string | null }) {
  const router = useRouter();
  const [plan, setPlan] = useState<RpPlan>(initial);
  const [step, setStep] = useState(isRpConfirmed(initial) ? 2 : initial.arrival || initial.dateless ? 1 : 0);
  const [messages, setMessages] = useState<RpChatMessage[]>([HELLO]);
  const [asking, setAsking] = useState<RpPending>(null);
  const [busy, setBusy] = useState(false);
  const [formRev, setFormRev] = useState(0);
  const [msg, setMsg] = useState<{ error?: string; problems?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const price = useMemo(() => priceRedPanda(plan, master), [plan, master]);
  // the tariff seasons a quote without dates can be priced on (newest first)
  const seasons = useMemo(() => rpSeasons(master), [master]);
  const s = master.settings;
  const set = (p: Partial<RpPlan>) => setPlan((x) => ({ ...x, ...p }));
  const setG = (g: Partial<RpPlan["guest"]>) => setPlan((x) => ({ ...x, guest: { ...x.guest, ...g } }));
  const n = guestCount(plan);
  const hotel = master.hotel;
  const delhiHotels = useMemo(() => (master.delhi?.hotels ?? []).map((h) => ({ id: h.property_id, name: h.name, rooms: h.rooms.map((r) => ({ id: r.id, name: r.name })) })), [master.delhi]);

  const rooms = useMemo(() => (master.hotel?.rooms ?? []).map((r) => ({ id: r.id, name: r.name })), [master.hotel]);
  const confirmed = isRpConfirmed(plan);
  const content = useMemo(() => rpGuestContent(plan, price, s), [plan, price, s]);
  const tripReady = (!!plan.arrival || !!plan.dateless) && plan.guest.adults >= 1 && plan.nights >= 1;
  const canGo = (n: number) => n === 0 || (n === 1 && tripReady) || (n >= 2 && tripReady && confirmed);
  const go = (n: number) => canGo(n) && setStep(n);

  async function onSend(text: string) {
    setMessages((m) => [...m, { role: "user", text }]);
    // Delhi, Kaziranga, our lodges: one place builds mixed trips (the Sales builder, Red Panda as a
    // stop). Not read here (the Red Panda reader would take Delhi's dates or nights as the Outpost's).
    setBusy(true);
    try {
      const r = await rpAssist({ message: text, pending: asking, guestName: plan.guest.name, hotelRooms: rooms.map((x) => x.name), delhiHotels: delhiHotels.map((x) => x.name) });
      if (r.error || !r.reading) {
        setMessages((m) => [...m, { role: "assistant", text: r.error ?? "Something went wrong; fill the form, or try again." }]);
        return;
      }
      const a = applyReading({ ...plan, enquiry: [plan.enquiry, text].filter(Boolean).join("\n---\n").slice(-6000) }, r.reading, s, rooms, delhiHotels);
      setPlan(a.plan);
      setFormRev((x) => x + 1);
      setAsking(a.pending);
      setMessages((m) => [...m, { role: "assistant", text: replyText(a, ""), source: r.note || undefined, quick: a.pending === "hotel_room" ? rooms.map((x) => x.name) : a.pending === "delhi_hotel" ? delhiHotels.map((x) => x.name) : a.pending ? QUICK[a.pending] : a.ready ? ["Check the trip"] : undefined }]);
      // Kaziranga, our tiger lodges: not part of a Red Panda quote (Delhi is)
      if (mentionsOtherPlaces(text))
        setMessages((m) => [...m, { role: "assistant", text: "A Red Panda quote covers Delhi, Bagdogra / Siliguri and Red Panda Outpost. Other places in the message (Kaziranga, our tiger lodges...) are not added here: quote them separately in Sales." }]);

    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Could not reach the server. Check the connection and try again." }]);
    } finally {
      setBusy(false);
    }
  }
  const send = (text: string) => (text === "Check the trip" && tripReady ? setStep(1) : void onSend(text));

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

  const q = nextQuestion(plan, {}, s, rooms);
  const priceCard = (
        <section className={`${ui.card} p-5`}>
          <p className="eyebrow">{queryNo ? `Quote ${queryNo}` : "New quote"}</p>
          <p className="mt-1 tabular font-display text-3xl font-semibold text-olive-800">{inr(price.totals.grand)}</p>
          <p className="text-sm text-sand-500">
            {price.guests} guest{price.guests === 1 ? "" : "s"} &middot; {inr(price.perPerson)} per person &middot; {price.rooms} room{price.rooms === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-xs text-sand-500">
            {price.dateless ? "Dates not fixed yet" : `${fmt(price.arrival)} to ${fmt(price.departure)}`}
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
                <li key={p.label} className="flex justify-between"><span>{p.label} ({p.pct}%), {p.due ? `by ${fmt(p.due)}` : (p.note ?? "at booking")}</span><span className="tabular">{inr(p.amount)}</span></li>
              ))}
            </ul>
          )}
        </section>);
  const alerts = (
        <>
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
        </>
  );
  const fixes = (key: string) => {
    const b = (label: string, fn: () => void, disabled = false) => (
      <button key={label} type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={disabled} onClick={fn}>{label}</button>
    );
    if (key === "guests") return [b("- adult", () => setG({ adults: Math.max(1, plan.guest.adults - 1) }), plan.guest.adults <= 1), b("+ adult", () => setG({ adults: plan.guest.adults + 1 }), n >= s.max_guests), b(plan.guest.nationality === "indian" ? "Make foreign" : "Make Indian", () => setG({ nationality: plan.guest.nationality === "indian" ? "foreign" : "indian", country: plan.guest.nationality === "indian" ? "" : "India" })), b(plan.guest.booked_by === "agent" ? "Make direct" : "Through an agent", () => setG({ booked_by: plan.guest.booked_by === "agent" ? "direct" : "agent" }))];
    if (key === "arrive" && plan.delhi_before.flight) return [];
    if (key === "depart" && plan.delhi_after.flight) return [];
    if (key === "arrive") return s.airports.filter((a) => a.code !== plan.arrive_airport).map((a) => b(`Land at ${a.code}`, () => set({ arrive_airport: a.code })));
    if (key === "depart") return s.airports.filter((a) => a.code !== plan.depart_airport).map((a) => b(`Fly out of ${a.code}`, () => set({ depart_airport: a.code })));
    if (key === "outpost") return [b("- night", () => set({ nights: plan.nights - 1 }), plan.nights <= s.min_nights), b("+ night", () => set({ nights: plan.nights + 1 }), plan.nights >= s.max_nights)];
    if (key === "hotel_before" || key === "hotel_after") return [b("Remove", () => set({ [key]: { nights: 0, room_id: null } } as Partial<RpPlan>))];
    if (key === "delhi_before" || key === "delhi_after") {
      const d = plan[key];
      return [
        b("- night", () => set({ [key]: { ...d, nights: d.nights - 1 } } as Partial<RpPlan>), d.nights <= 0),
        b("+ night", () => set({ [key]: { ...d, nights: d.nights + 1, hotel_id: d.hotel_id ?? delhiHotels[0]?.id ?? null, room_id: d.room_id ?? delhiHotels[0]?.rooms[0]?.id ?? null } } as Partial<RpPlan>), d.nights >= 5),
        b("Remove Delhi", () => set({ [key]: { flight: false, nights: 0, hotel_id: null, room_id: null } } as Partial<RpPlan>)),
      ];
    }
    return [];
  };

  return (
    <div className="space-y-6">
      <Stepper step={step} canGo={canGo} go={go} />

      {step === 0 && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <RpChat messages={messages} busy={busy} onSend={send} />
          </div>
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
                key={formRev}
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
              {plan.dateless ? (
                <p className="rounded-lg border border-dashed border-sand-300 bg-sand-50 px-3 py-2 text-sm text-sand-600">Not fixed yet</p>
              ) : (
                <input className={ui.input} type="date" value={plan.arrival ?? ""} onChange={(e) => set({ arrival: e.target.value || null })} />
              )}
              <label className="mt-1.5 flex items-center gap-2 text-xs text-sand-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!plan.dateless}
                  onChange={(e) => set(e.target.checked ? { dateless: true, arrival: null, rate_season: seasons[0]?.season ?? null } : { dateless: undefined, rate_season: undefined })}
                />
                Dates not fixed yet (price on a season&apos;s tariff)
              </label>
              {plan.dateless && (
                <select className={`${ui.select} mt-1.5 w-full !py-1.5 text-xs`} aria-label="Tariff season" value={plan.rate_season ?? seasons[0]?.season ?? ""} onChange={(e) => set({ rate_season: e.target.value || null })}>
                  {seasons.map((x) => (
                    <option key={x.season} value={x.season}>
                      Tariff {x.season} ({monthYear(x.from)} to {monthYear(x.to)})
                    </option>
                  ))}
                </select>
              )}
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
          <div>
            <h2 className="text-lg">Delhi (optional)</h2>
            <p className="text-sm text-sand-500">Foreign guests usually land in Delhi: the flight Delhi - Bagdogra, and nights at a Delhi hotel (0 = connect the same day).</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["delhi_before", "delhi_after"] as const).map((k) => {
              const d = plan[k];
              const h = delhiHotels.find((x) => x.id === d.hotel_id);
              const setD = (x: Partial<RpPlan["delhi_before"]>) => set({ [k]: { ...d, ...x } } as Partial<RpPlan>);
              return (
                <div key={k} className="space-y-2 rounded-lg border border-sand-200 p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-olive-800">
                    <input type="checkbox" className="h-4 w-4 accent-olive-600" checked={d.flight} onChange={(e) => (e.target.checked ? set({ [k]: { ...d, flight: true }, ...(k === "delhi_before" ? { arrive_airport: "IXB" } : { depart_airport: "IXB" }) } as Partial<RpPlan>) : setD({ flight: false, nights: 0, hotel_id: null, room_id: null }))} />
                    {k === "delhi_before" ? "Land in Delhi first, fly to Bagdogra" : "Fly back to Delhi at the end"}
                  </label>
                  {d.flight && (
                    <div className="grid grid-cols-[80px_1fr] gap-2">
                      <input className={ui.inputSm} type="number" min={0} max={5} aria-label="Nights in Delhi" value={d.nights} onChange={(e) => setD({ nights: num(e.target.value), ...(num(e.target.value) > 0 && !d.hotel_id && delhiHotels[0] ? { hotel_id: delhiHotels[0].id, room_id: delhiHotels[0].rooms[0]?.id ?? null } : {}) })} />
                      <select className={`${ui.select} w-full py-2`} aria-label="Delhi hotel" disabled={d.nights <= 0} value={d.hotel_id ?? ""} onChange={(e) => { const x = delhiHotels.find((y) => y.id === e.target.value); setD({ hotel_id: x?.id ?? null, room_id: x?.rooms[0]?.id ?? null }); }}>
                        <option value="">{delhiHotels.length ? "Delhi hotel" : "No Delhi hotel in Master data"}</option>
                        {delhiHotels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      {h && h.rooms.length > 1 && d.nights > 0 && (
                        <select className={`${ui.select} col-span-2 w-full py-2`} aria-label="Delhi room" value={d.room_id ?? ""} onChange={(e) => setD({ room_id: e.target.value || null })}>
                          {h.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                  {d.flight && <p className="text-xs text-sand-500">Nights in Delhi (0 = connect the same day), with the Delhi Airport transfers.</p>}
                </div>
              );
            })}
          </div>
          {(plan.delhi_before.flight || plan.delhi_after.flight) && (
            <Field label="Flight fare per person, one way" hint={master.delhi?.out || master.delhi?.back ? `Empty = Sales Master data (Delhi - Bagdogra ${inr(master.delhi?.out?.fare ?? master.delhi?.back?.fare ?? 0)})` : "Not in Sales Master data > Flight routes: type it"}>
              <input className={ui.input} type="number" min={0} value={plan.flight_fare_pp ?? ""} placeholder={String(master.delhi?.out?.fare ?? master.delhi?.back?.fare ?? "")} onChange={(e) => set({ flight_fare_pp: e.target.value === "" ? null : num(e.target.value) })} />
            </Field>
          )}
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
            <div className="flex flex-wrap items-center justify-end gap-3">
              {!tripReady && <p className="text-sm text-sand-500">{q.question ?? "Add the arrival date and the guests."}</p>}
              <button type="button" className={ui.btnPrimary} disabled={!tripReady} onClick={() => setStep(1)}>Next: Confirm</button>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className={`${ui.card} space-y-4 p-5`}>
            <div>
              <h2 className="text-lg">Is this the trip?</h2>
              <p className="text-sm text-sand-500">Read it as the guest would. Fix anything here, or go back to Trip.</p>
            </div>
            <ol className="space-y-3">
              {tripSummary(plan, s, hotel?.name ?? null, delhiHotels).map((l, i) => (
                <li key={l.key} className="flex flex-col gap-2 rounded-lg border border-sand-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-olive-100 text-xs font-semibold text-olive-700">{i + 1}</span><span className="text-sm text-olive-800">{l.text}</span></span>
                  <span className="flex flex-wrap gap-1.5">{fixes(l.key)}</span>
                </li>
              ))}
            </ol>
            {price.errors.length > 0 && (
              <div className={ui.alertError}>
                <p className="font-semibold">Before you continue</p>
                <ul className="mt-1 list-disc pl-4">{price.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className={ui.btnSecondary} onClick={() => setStep(0)}>Back to Trip</button>
              <button type="button" className={ui.btnPrimary} disabled={!tripReady} onClick={() => { set({ confirmed: rpConfirmKey(plan) }); setStep(2); }}>
                <Icon name="check" className="h-[18px] w-[18px]" /> Correct, continue
              </button>
            </div>
          </section>
          <aside className="space-y-4">{priceCard}</aside>
        </div>
      )}

      {step >= 2 && (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        {step === 2 && (
          <>
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
            <div className="flex justify-end">
              <button type="button" className={ui.btnPrimary} onClick={() => setStep(3)}>Next: Final draft</button>
            </div>
          </>
        )}
        {step === 3 && (
          <section className={`${ui.card} space-y-5 p-5`}>
            <div>
              <h2 className="text-lg">Final draft: what the guest reads</h2>
              <p className="text-sm text-sand-500">Change the text for this quote only. Empty = the text from Master data.</p>
            </div>
            <Field label="Introduction">
              <textarea className={ui.input} rows={5} value={plan.text.intro || s.intro} onChange={(e) => set({ text: { ...plan.text, intro: e.target.value === s.intro ? "" : e.target.value } })} />
            </Field>
            <div className="space-y-3">
              <p className={ui.label}>Day by day</p>
              {content.days.map((d) => (
                <div key={d.n} className="rounded-lg border border-sand-200 p-3">
                  <p className="text-sm font-semibold text-olive-800">{rpDayLabel(d)}{d.dateText ? `, ${d.dateText}` : ""}: {d.title}</p>
                  <textarea
                    className={`${ui.input} mt-2`}
                    rows={3}
                    value={d.text}
                    onChange={(e) => set({ text: { ...plan.text, days: { ...plan.text.days, [String(d.n)]: e.target.value } } })}
                  />
                  {plan.text.days[String(d.n)] && (
                    <button type="button" className="mt-1 text-xs text-olive-700 underline" onClick={() => { const rest = { ...plan.text.days }; delete rest[String(d.n)]; set({ text: { ...plan.text, days: rest } }); }}>Back to the standard text</button>
                  )}
                </div>
              ))}
            </div>
            <Field label="Notes for this guest (one per line; shown first under Good to know)">
              <textarea className={ui.input} rows={3} value={plan.text.notes.join("\n")} onChange={(e) => set({ text: { ...plan.text, notes: e.target.value.split("\n") } })} />
            </Field>
            <details className="rounded-lg border border-sand-200 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-olive-800">Includes, does not include, good to know (from Master data)</summary>
              <p className="mt-2 font-medium">Includes</p>
              <ul className="list-disc pl-5">{content.inclusions.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="mt-2 font-medium">Does not include</p>
              <ul className="list-disc pl-5">{content.exclusions.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="mt-2 font-medium">Good to know</p>
              <ul className="list-disc pl-5">{content.goodToKnow.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </details>
          </section>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        {priceCard}
        {alerts}
        {step === 3 ? (
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
        ) : null}
      </aside>
    </div>
      )}
    </div>
  );
}
