"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui, Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { dayName } from "@/lib/sales/pricing/dates";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { PriceResult } from "@/lib/sales/pricing/types";
import {
  buildDays,
  defaultStop,
  describe,
  lodgesInPark,
  mealPlansOf,
  planToTrip,
  roomsOf,
  routeProblems,
} from "@/lib/sales/plan/planner";
import type { BuilderContext, DaySafari, Plan, PlanDay, PlanStop } from "@/lib/sales/plan/types";
import { saveItinerary } from "@/app/(dashboard)/sales/new/actions";
import { aiReadTrip } from "@/app/(dashboard)/sales/new/ai-actions";
import { applyParsed, extractTrip, mergeParsed, needsHelp } from "@/lib/sales/plan/parse-text";

const STEPS = ["Guest", "Route", "Day plan", "Price & save"];
const SOURCES = ["Website", "Email", "Phone", "Travel agent", "Repeat guest", "Referral", "Other"];
const MEAL_LABEL: Record<string, string> = { AP: "AP - full board", MAP: "MAP - breakfast + one meal", CP: "CP - breakfast", EP: "EP - room only" };

const routeKey = (p: Plan) =>
  JSON.stringify([p.arrival_date, p.arrival_location_id, p.departure_location_id, p.stops, p.vehicle_type, p.guest.rooms]);

// ---------------------------------------------------------------------------
function Stepper({ step, maxStep, go }: { step: number; maxStep: number; go: (n: number) => void }) {
  return (
    <div className={`${ui.card} mb-6 overflow-x-auto p-4`}>
      <ol className="flex min-w-[560px] items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          const reachable = i <= maxStep;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => go(i)}
                className="flex items-center gap-2 text-sm disabled:cursor-not-allowed"
              >
                <span
                  className={
                    "grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold " +
                    (done ? "border-olive-600 bg-olive-600 text-white" : active ? "border-olive-600 bg-white text-olive-600 ring-4 ring-olive-100" : "border-sand-300 bg-white text-sand-500")
                  }
                >
                  {done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
                </span>
                <span className={active ? "font-semibold text-olive-800" : done ? "text-olive-800" : "text-sand-500"}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={"h-px flex-1 " + (done ? "bg-olive-600" : "bg-sand-200")} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Field({ label, required, children, hint, wide }: { label: string; required?: boolean; children: React.ReactNode; hint?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className={ui.label}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-sand-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TripText({
  onRead,
  busy,
  outcome,
}: {
  onRead: (text: string) => void;
  busy: boolean;
  outcome: { understood: string[]; missing: string[]; source: string } | null;
}) {
  const [text, setText] = useState("");
  return (
    <section className="space-y-3 rounded-xl border border-olive-100 bg-olive-50/60 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon name="send" className="h-[18px] w-[18px] text-olive-600" />
        <h2 className="text-base">Describe the trip</h2>
        <span className="text-xs text-sand-500">optional</span>
      </div>
      <textarea
        className={ui.input}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 2 adults, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, Nagpur out, full board"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-sand-500">Fills guests, dates, parks and transfers. You can check and change everything after.</p>
        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={busy || text.trim().length < 5} onClick={() => onRead(text)}>
          {busy ? "Reading..." : "Fill from text"}
        </button>
      </div>
      {outcome && (
        <div className="space-y-2 text-sm">
          {outcome.understood.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {outcome.understood.map((u, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border border-success-border bg-success-bg px-2.5 py-0.5 text-xs font-medium text-success">
                  <Icon name="check" className="h-3.5 w-3.5" />
                  {u}
                </span>
              ))}
            </div>
          )}
          {outcome.missing.length > 0 && (
            <ul className={`${ui.alertWarning} list-disc space-y-0.5 pl-6 text-xs`}>
              {outcome.missing.map((m, i) => <li key={i}>{m.match(/^[A-Z"]/) ? m : `Not found: ${m}`}</li>)}
            </ul>
          )}
          <p className="text-xs text-sand-500">Read by {outcome.source}.</p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Summary({ plan, ctx, result, problems }: { plan: Plan; ctx: BuilderContext; result: PriceResult | null; problems: string[] }) {
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);
  const safaris = plan.days.reduce((t, d) => t + d.safaris.length, 0);
  const parkNames = plan.stops.map((s) => `${ctx.pricing.parks.find((p) => p.id === s.park_id)?.name ?? "?"} ${s.nights}`).join(", ");
  const errs = [...problems, ...(result?.errors ?? [])];
  return (
    <aside className={`${ui.card} space-y-4 p-5 lg:sticky lg:top-24`}>
      <h2 className="text-lg">Trip summary</h2>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-sand-500">Guest</dt><dd className="text-right font-medium text-olive-800">{plan.guest.name || "-"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-sand-500">Guests / rooms</dt><dd className="text-right font-medium text-olive-800">{plan.guest.adults + plan.guest.children.length} / {plan.guest.rooms}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-sand-500">Nights</dt><dd className="text-right font-medium text-olive-800">{nights ? `${nights} (${parkNames})` : "-"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-sand-500">Safaris</dt><dd className="text-right font-medium text-olive-800">{safaris || "-"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-sand-500">Dates</dt><dd className="text-right font-medium text-olive-800">{result?.arrival ? `${fmtDate(result.arrival)} - ${fmtDate(result.departure)}` : "-"}</dd></div>
      </dl>
      {errs.length > 0 && (
        <div className={ui.alertError}>
          <p className="font-semibold">{errs.length} to fix</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">{errs.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <div className="border-t border-sand-200 pt-4">
        <p className="eyebrow">Running total</p>
        <p className="tabular mt-1 font-display text-3xl font-semibold text-olive-800">{result ? rupees(result.totals.grand) : "-"}</p>
        {result && <p className="text-xs text-sand-500">{rupees(result.perPerson)} per person</p>}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
export function Builder({
  ctx,
  initial,
  queryId,
  today,
  aiAvailable = false,
}: {
  ctx: BuilderContext;
  initial: Plan;
  queryId: string | null;
  today: string;
  aiAvailable?: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>(initial);
  const [step, setStep] = useState(initial.days.length ? 2 : 0);
  const [maxStep, setMaxStep] = useState(initial.days.length ? 3 : 0);
  const [builtKey, setBuiltKey] = useState(initial.days.length ? routeKey(initial) : "");
  const [childrenText, setChildrenText] = useState(initial.guest.children.join(", "));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveProblems, setSaveProblems] = useState<string[]>([]);
  const [saving, startSave] = useTransition();
  const [reading, startReading] = useTransition();
  const [readOutcome, setReadOutcome] = useState<{ understood: string[]; missing: string[]; source: string } | null>(null);

  const problems = useMemo(() => routeProblems(plan, ctx), [plan, ctx]);
  const stale = plan.days.length > 0 && routeKey(plan) !== builtKey;
  const result = useMemo(
    () => (plan.days.length && !problems.length ? priceTrip(planToTrip(plan, today), ctx.pricing) : null),
    [plan, problems, ctx, today]
  );

  const setGuest = (patch: Partial<Plan["guest"]>) => setPlan((p) => ({ ...p, guest: { ...p.guest, ...patch } }));
  const setStop = (i: number, patch: Partial<PlanStop>) =>
    setPlan((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const go = (n: number) => {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const transferLocations = ctx.locations.filter((l) => l.type !== "property");
  const vehicleTypes = [...new Set(ctx.pricing.transferRates.map((t) => t.vehicle_type))].sort();
  const parkName = (id: string | null) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? "";
  const lodgeName = (id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const locName = (id: string) => ctx.locations.find((l) => l.id === id)?.name ?? "?";

  // ---------------- route helpers ----------------
  function addStop(parkId: string) {
    if (!parkId) return;
    setPlan((p) => ({ ...p, stops: [...p.stops, defaultStop(ctx, parkId, 3)] }));
  }
  function changePark(i: number, parkId: string) {
    setStop(i, defaultStop(ctx, parkId, plan.stops[i].nights));
  }
  function changeLodge(i: number, propertyId: string) {
    const room = roomsOf(ctx, propertyId)[0];
    const meal = room ? mealPlansOf(ctx, room.id)[0] ?? "AP" : "AP";
    setStop(i, { property_id: propertyId, room_category_id: room?.id ?? "", meal_plan: meal });
  }
  function changeRoom(i: number, roomId: string) {
    const meals = mealPlansOf(ctx, roomId);
    setStop(i, { room_category_id: roomId, meal_plan: meals.includes(plan.stops[i].meal_plan) ? plan.stops[i].meal_plan : meals[0] ?? "AP" });
  }
  function moveStop(i: number, d: -1 | 1) {
    setPlan((p) => {
      const s = [...p.stops];
      const j = i + d;
      if (j < 0 || j >= s.length) return p;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...p, stops: s };
    });
  }
  function build() {
    setPlan((p) => ({ ...p, days: buildDays(p, ctx) }));
    setBuiltKey(routeKey(plan));
    go(2);
  }

  // ---------------- day helpers ----------------
  function setDay(i: number, next: PlanDay) {
    setPlan((p) => ({ ...p, days: p.days.map((d, j) => (j === i ? next : d)) }));
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
    // Rewrite the text only if the user has not edited it.
    const described = describe(ctx, next, plan.vehicle_type);
    setDay(i, day.text === autoText ? described : { ...next, title: day.title });
  }

  // Built-in reader first (instant, free). Only if it cannot find the parks
  // or the date, and AI is switched on, ask the server's AI fallback.
  function readText(text: string) {
    startReading(async () => {
      let parsed = extractTrip(text, ctx, today);
      let source = "the built-in reader";
      const extraNotes: string[] = [];
      if (needsHelp(parsed) && aiAvailable) {
        const ai = await aiReadTrip(text);
        if (ai.parsed) {
          parsed = mergeParsed(parsed, ai.parsed);
          source = "the built-in reader with AI help";
        } else if (ai.error) extraNotes.push(ai.error);
      }
      const r = applyParsed(plan, parsed, ctx);
      setPlan(r.plan);
      setChildrenText(r.plan.guest.children.join(", "));
      setReadOutcome({ understood: r.understood, missing: [...r.missing, ...extraNotes], source });
      if (r.plan.stops.length && step === 0 && plan.guest.name.trim()) go(1);
    });
  }

  function save() {
    setSaveError(null);
    setSaveProblems([]);
    startSave(async () => {
      const res = await saveItinerary(JSON.stringify(plan), queryId);
      if (res.error) setSaveError(res.error);
      else if (res.problems?.length) setSaveProblems(res.problems);
      else if (res.id) {
        router.push(`/sales/queries/${res.id}`);
        router.refresh();
      }
    });
  }

  const offersAvailable = ctx.pricing.offers;
  const settingsMarkup = ctx.pricing.settings.markup_pct ?? 0;

  // =====================================================================
  return (
    <div>
      <Stepper step={step} maxStep={maxStep} go={go} />

      <div className={step >= 2 ? "grid gap-6 lg:grid-cols-[1fr_320px]" : ""}>
        <div className="min-w-0 space-y-6">
          {step <= 1 && <TripText onRead={readText} busy={reading} outcome={readOutcome} />}

          {/* ---------------- STEP 1: GUEST ---------------- */}
          {step === 0 && (
            <section className={`${ui.card} space-y-5 p-5 sm:p-6`}>
              <h2 className="text-lg">Guest details</h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Guest name" required wide>
                  <input className={ui.input} value={plan.guest.name} onChange={(e) => setGuest({ name: e.target.value })} placeholder="e.g. Judy & Cathy Miller" />
                </Field>
                <Field label="Email">
                  <input className={ui.input} type="email" value={plan.guest.email} onChange={(e) => setGuest({ email: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <input className={ui.input} value={plan.guest.phone} onChange={(e) => setGuest({ phone: e.target.value })} />
                </Field>
                <Field label="Nationality" hint="Some parks charge foreign guests differently.">
                  <select className={`${ui.select} w-full`} value={plan.guest.nationality} onChange={(e) => setGuest({ nationality: e.target.value as "indian" | "foreign" })}>
                    <option value="foreign">Foreign</option>
                    <option value="indian">Indian</option>
                  </select>
                </Field>
                <Field label="Source">
                  <select className={`${ui.select} w-full`} value={plan.guest.source} onChange={(e) => setGuest({ source: e.target.value })}>
                    <option value="">- Choose -</option>
                    {SOURCES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Adults" required>
                  <input className={ui.input} type="number" min={1} value={plan.guest.adults} onChange={(e) => setGuest({ adults: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
                <Field label="Children's ages" hint="Separate with commas, e.g. 8, 12. Leave empty if none.">
                  <input
                    className={ui.input}
                    value={childrenText}
                    onChange={(e) => setChildrenText(e.target.value)}
                    onBlur={() => {
                      const ages = childrenText.split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 18);
                      setGuest({ children: ages });
                      setChildrenText(ages.join(", "));
                    }}
                  />
                </Field>
                <Field label="Rooms" required hint="Guests are spread evenly over rooms.">
                  <input className={ui.input} type="number" min={1} value={plan.guest.rooms} onChange={(e) => setGuest({ rooms: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
                {plan.guest.source === "Travel agent" && (
                  <Field label="Agent name">
                    <input className={ui.input} value={plan.guest.agent_name} onChange={(e) => setGuest({ agent_name: e.target.value })} />
                  </Field>
                )}
                <Field label="Internal notes" wide>
                  <textarea className={ui.input} rows={3} value={plan.guest.notes} onChange={(e) => setGuest({ notes: e.target.value })} placeholder="Preferences, special occasions, dietary needs" />
                </Field>
              </div>
              <div className="flex justify-end">
                <button type="button" className={ui.btnPrimary} disabled={!plan.guest.name.trim()} onClick={() => go(1)}>
                  Next: route
                </button>
              </div>
            </section>
          )}

          {/* ---------------- STEP 2: ROUTE ---------------- */}
          {step === 1 && (
            <section className={`${ui.card} space-y-6 p-5 sm:p-6`}>
              <h2 className="text-lg">Route</h2>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Arrival date" required>
                  <input className={ui.input} type="date" value={plan.arrival_date} min={today} onChange={(e) => e.target.value && setPlan((p) => ({ ...p, arrival_date: e.target.value }))} />
                </Field>
                <Field label="Arriving at">
                  <select className={`${ui.select} w-full`} value={plan.arrival_location_id ?? ""} onChange={(e) => setPlan((p) => ({ ...p, arrival_location_id: e.target.value || null }))}>
                    <option value="">Guest reaches the lodge on their own</option>
                    {transferLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
                <Field label="Leaving from">
                  <select className={`${ui.select} w-full`} value={plan.departure_location_id ?? ""} onChange={(e) => setPlan((p) => ({ ...p, departure_location_id: e.target.value || null }))}>
                    <option value="">Guest leaves on their own</option>
                    {transferLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </Field>
              </div>

              <div className="space-y-3">
                <p className={ui.label}>Parks, in travel order</p>
                {plan.stops.length === 0 && <div className={ui.empty}>Add the first park below.</div>}
                {plan.stops.map((s, i) => {
                  const lodges = lodgesInPark(ctx, s.park_id);
                  const rooms = s.property_id ? roomsOf(ctx, s.property_id) : [];
                  const meals = s.room_category_id ? mealPlansOf(ctx, s.room_category_id) : [];
                  return (
                    <div key={i} className="rounded-xl border border-sand-200 bg-sand-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-olive-800">{i + 1}. {parkName(s.park_id)}</span>
                        <div className="flex gap-1">
                          <button type="button" className={`${ui.btnGhost} ${ui.btnSm} px-2`} disabled={i === 0} onClick={() => moveStop(i, -1)} aria-label="Move earlier"><Icon name="chevronLeft" className="h-4 w-4 rotate-90" /></button>
                          <button type="button" className={`${ui.btnGhost} ${ui.btnSm} px-2`} disabled={i === plan.stops.length - 1} onClick={() => moveStop(i, 1)} aria-label="Move later"><Icon name="chevronLeft" className="h-4 w-4 -rotate-90" /></button>
                          <button type="button" className={`${ui.btnGhost} ${ui.btnSm} px-2 !text-error`} onClick={() => setPlan((p) => ({ ...p, stops: p.stops.filter((_, j) => j !== i) }))} aria-label="Remove park"><Icon name="trash" className="h-4 w-4" /></button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-5">
                        <select className={`${ui.select} w-full sm:col-span-1`} value={s.park_id} onChange={(e) => changePark(i, e.target.value)} aria-label="Park">
                          {ctx.pricing.parks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <input className={ui.inputSm} type="number" min={1} value={s.nights} onChange={(e) => setStop(i, { nights: Math.max(1, Number(e.target.value) || 1) })} aria-label="Nights" title="Nights" />
                        <select className={`${ui.select} w-full`} value={s.property_id} onChange={(e) => changeLodge(i, e.target.value)} aria-label="Lodge">
                          {!lodges.length && <option value="">No lodge in this park</option>}
                          {lodges.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <select className={`${ui.select} w-full`} value={s.room_category_id} onChange={(e) => changeRoom(i, e.target.value)} aria-label="Room">
                          {!rooms.length && <option value="">No rooms</option>}
                          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <select className={`${ui.select} w-full`} value={s.meal_plan} onChange={(e) => setStop(i, { meal_plan: e.target.value })} aria-label="Meal plan">
                          {(meals.length ? meals : [s.meal_plan]).map((m) => <option key={m} value={m}>{MEAL_LABEL[m] ?? m}</option>)}
                        </select>
                      </div>
                      <p className="mt-2 text-xs text-sand-500">Park, nights, lodge, room, meal plan</p>
                    </div>
                  );
                })}
                <select className={`${ui.select} w-full sm:w-72`} value="" onChange={(e) => addStop(e.target.value)} aria-label="Add a park">
                  <option value="">+ Add a park</option>
                  {ctx.pricing.parks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {vehicleTypes.length > 1 && (
                <Field label="Transfer vehicle">
                  <select className={`${ui.select} w-full sm:w-72`} value={plan.vehicle_type ?? ""} onChange={(e) => setPlan((p) => ({ ...p, vehicle_type: e.target.value || null }))}>
                    <option value="">Cheapest suitable</option>
                    {vehicleTypes.map((v) => <option key={v}>{v}</option>)}
                  </select>
                </Field>
              )}

              {problems.length > 0 && plan.stops.length > 0 && (
                <ul className={`${ui.alertWarning} list-disc space-y-0.5 pl-6`}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              )}
              {stale && <p className={ui.alertWarning}>The route has changed since the day plan was built. Rebuilding replaces the day plan, including any text you edited.</p>}

              <div className="flex justify-between gap-2">
                <button type="button" className={ui.btnSecondary} onClick={() => go(0)}>Back</button>
                <div className="flex gap-2">
                  {plan.days.length > 0 && !stale && <button type="button" className={ui.btnSecondary} onClick={() => go(2)}>Keep current plan</button>}
                  <button type="button" className={ui.btnPrimary} disabled={problems.length > 0} onClick={build}>
                    {plan.days.length ? "Rebuild day plan" : "Build day plan"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ---------------- STEP 3: DAY PLAN ---------------- */}
          {step === 2 && (
            <section className="space-y-4">
              {stale && <p className={ui.alertWarning}>The route has changed. Go back to Route and rebuild the plan.</p>}
              {plan.days.map((d, i) => (
                <div key={d.date + i} className={`${ui.card} space-y-4 p-5`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-olive-50 font-display font-semibold text-olive-600">{i + 1}</span>
                      <div>
                        <p className="font-display font-semibold text-olive-800">Day {i + 1} - {fmtDate(d.date)} ({dayName(d.date)})</p>
                        <p className="text-sm text-sand-500">{d.property_id ? lodgeName(d.property_id) : "Departure"}</p>
                      </div>
                    </div>
                    <Badge tone="neutral">{d.kind}</Badge>
                  </div>

                  {d.notes.map((n, k) => (
                    <p key={k} className={`${ui.alertWarning} flex gap-2`}><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{n}</p>
                  ))}

                  {d.transfer && (
                    <p className="flex flex-wrap items-center gap-2 rounded-lg bg-sand-50 p-3 text-sm">
                      <Icon name="car" className="h-4 w-4 text-sand-500" />
                      {locName(d.transfer.from_location_id)} to {locName(d.transfer.to_location_id)}
                    </p>
                  )}

                  {d.park_id && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(["morning", "afternoon"] as const).map((session) => {
                        const cur = d.safaris.find((s) => s.session === session)?.zone ?? "";
                        return (
                          <label key={session} className="flex items-center justify-between gap-3 rounded-lg border border-sand-200 p-3 text-sm">
                            <span className="font-medium text-olive-800">{session === "morning" ? "Morning safari" : "Evening safari"}</span>
                            <select className={ui.select} value={cur} onChange={(e) => setSafari(i, session, e.target.value as "" | "core" | "buffer")}>
                              <option value="">None</option>
                              <option value="core">Core zone</option>
                              <option value="buffer">Buffer zone</option>
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid gap-3">
                    <input className={`${ui.inputSm} font-semibold`} value={d.title} onChange={(e) => setDay(i, { ...d, title: e.target.value })} aria-label="Day title" />
                    <textarea className={ui.inputSm} rows={2} value={d.text} onChange={(e) => setDay(i, { ...d, text: e.target.value })} aria-label="Day description" />
                  </div>
                </div>
              ))}
              <div className="flex justify-between gap-2">
                <button type="button" className={ui.btnSecondary} onClick={() => go(1)}>Back to route</button>
                <button type="button" className={ui.btnPrimary} disabled={stale} onClick={() => go(3)}>Next: price</button>
              </div>
            </section>
          )}

          {/* ---------------- STEP 4: PRICE & SAVE ---------------- */}
          {step === 3 && (
            <section className="space-y-6">
              <div className={`${ui.card} grid gap-5 p-5 sm:grid-cols-2 sm:p-6`}>
                <Field label="Offers" wide hint="Offers that do not apply to this trip are skipped with a note.">
                  {offersAvailable.length === 0 ? (
                    <p className="text-sm text-sand-500">No active offers.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {offersAvailable.map((o) => (
                        <label key={o.id} className="flex items-center gap-2 rounded-lg border border-sand-200 p-3 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={plan.offer_ids.includes(o.id)}
                            onChange={(e) =>
                              setPlan((p) => ({ ...p, offer_ids: e.target.checked ? [...p.offer_ids, o.id] : p.offer_ids.filter((x) => x !== o.id) }))
                            }
                          />
                          {o.name}
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
                <Field label="Markup %" hint={`Empty = default from settings (${settingsMarkup}%).`}>
                  <input
                    className={ui.input}
                    type="number"
                    step="any"
                    value={plan.markup_pct ?? ""}
                    onChange={(e) => setPlan((p) => ({ ...p, markup_pct: e.target.value === "" ? null : Number(e.target.value) }))}
                  />
                </Field>
                <Field label="Quote currency">
                  <select className={`${ui.select} w-full`} value={plan.currency} onChange={(e) => setPlan((p) => ({ ...p, currency: e.target.value as "INR" | "USD" }))}>
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                </Field>
                <Field label="Manual adjustment (Rs)" hint="Negative for a discount, e.g. -5000.">
                  <input
                    className={ui.input}
                    type="number"
                    value={plan.adjustment?.amount ?? ""}
                    onChange={(e) => {
                      const amount = Number(e.target.value);
                      setPlan((p) => ({ ...p, adjustment: e.target.value === "" || !amount ? null : { amount, reason: p.adjustment?.reason ?? "" } }));
                    }}
                  />
                </Field>
                <Field label="Reason for adjustment" required={!!plan.adjustment}>
                  <input
                    className={ui.input}
                    disabled={!plan.adjustment}
                    value={plan.adjustment?.reason ?? ""}
                    onChange={(e) => setPlan((p) => (p.adjustment ? { ...p, adjustment: { ...p.adjustment, reason: e.target.value } } : p))}
                    placeholder="e.g. Repeat guest goodwill"
                  />
                </Field>
              </div>

              {result && (
                <>
                  {result.warnings.length > 0 && (
                    <ul className={`${ui.alertWarning} list-disc space-y-0.5 pl-6`}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  )}

                  <div className={`${ui.card} overflow-hidden`}>
                    <div className="border-b border-sand-200 p-5"><h2 className="text-lg">By lodge</h2></div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                            <th className="px-4 py-3">Lodge</th>
                            <th className="px-4 py-3 text-right">Rooms</th>
                            <th className="px-4 py-3 text-right">Safaris</th>
                            <th className="px-4 py-3 text-right">Transfers</th>
                            <th className="px-4 py-3 text-right">Discount</th>
                            <th className="px-4 py-3 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.byProperty.map((p) => (
                            <tr key={p.property_id ?? "none"} className="border-t border-sand-200">
                              <td className="px-4 py-3 font-medium text-olive-800">{p.name}</td>
                              <td className="tabular px-4 py-3 text-right">{rupees(p.room)}</td>
                              <td className="tabular px-4 py-3 text-right">{rupees(p.safari)}</td>
                              <td className="tabular px-4 py-3 text-right">{rupees(p.transfer)}</td>
                              <td className="tabular px-4 py-3 text-right">{p.discount ? rupees(p.discount) : "-"}</td>
                              <td className="tabular px-4 py-3 text-right font-semibold">{rupees(p.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    <div className={`${ui.card} space-y-2 p-5 text-sm`}>
                      <h2 className="mb-2 text-lg">Totals</h2>
                      {([
                        ["Rooms", result.totals.room],
                        ["Safaris", result.totals.safari],
                        ["Transfers", result.totals.transfer],
                        ["Add-ons", result.totals.addon],
                        ["Discounts", result.totals.discount],
                        ["Markup", result.totals.markup],
                        ["Adjustment", result.totals.adjustment],
                      ] as [string, number][])
                        .filter(([, v]) => v !== 0)
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between"><span className="text-sand-500">{k}</span><span className="tabular">{rupees(v)}</span></div>
                        ))}
                      <div className="flex justify-between border-t border-sand-200 pt-2 font-semibold text-olive-800"><span>Total</span><span className="tabular">{rupees(result.totals.grand)}</span></div>
                      <div className="flex justify-between"><span className="text-sand-500">Per person</span><span className="tabular">{rupees(result.perPerson)}</span></div>
                      {result.currency === "USD" && result.fx && (
                        <div className="flex justify-between"><span className="text-sand-500">In USD (at {result.fx})</span><span className="tabular">USD {result.grandInCurrency.toLocaleString("en-US")}</span></div>
                      )}
                    </div>
                    <div className={`${ui.card} space-y-2 p-5 text-sm`}>
                      <h2 className="mb-2 text-lg">Payment schedule</h2>
                      {result.payments.map((p, i) => (
                        <div key={i}>
                          <div className="flex justify-between gap-3">
                            <span>{p.label}<span className="text-sand-500"> - {p.due ? `by ${fmtDate(p.due)}` : "at booking"}</span></span>
                            <span className="tabular">{rupees(p.amount)}</span>
                          </div>
                          {p.note && <p className="text-xs text-sand-500">{p.note}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {saveError && <p className={ui.alertError}>{saveError}</p>}
              {saveProblems.length > 0 && (
                <div className={ui.alertError}>
                  <p className="font-semibold">Fix these before saving:</p>
                  <ul className="mt-1 list-disc pl-5">{saveProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}

              <div className="flex justify-between gap-2">
                <button type="button" className={ui.btnSecondary} onClick={() => go(2)}>Back</button>
                <button
                  type="button"
                  className={ui.btnPrimary}
                  disabled={saving || stale || !result || result.errors.length > 0 || !plan.guest.name.trim()}
                  onClick={save}
                >
                  {saving ? "Saving..." : queryId ? "Save as new version" : "Save query"}
                </button>
              </div>
            </section>
          )}
        </div>

        {step >= 2 && <Summary plan={plan} ctx={ctx} result={result} problems={stale ? [] : problems} />}
      </div>
    </div>
  );
}
