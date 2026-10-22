"use client";

import { useEffect, useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { commonVehicles, defaultStop, lodgesInPark, mealPlansOf, roomsOf } from "@/lib/sales/plan/planner";
import type { BuilderContext, Plan, PlanStop } from "@/lib/sales/plan/types";
import type { ChatFlags } from "@/lib/sales/plan/chat";
import { Field } from "./field";
import { CountrySelect, PhoneField } from "./guest-fields";
import { countryName } from "@/lib/sales/countries";

const SOURCES = ["Website", "Email", "Phone", "Travel agent", "Repeat guest", "Referral", "Other"];
const MEAL_LABEL: Record<string, string> = { AP: "AP - full board", MAP: "MAP - breakfast + dinner", CP: "CP - breakfast", EP: "EP - room only" };
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SetPlan = (u: (p: Plan) => Plan) => void;

// The form on the right of the chat. Same data as the chat: editing here
// updates the trip, and the assistant sees it on the next message.
export function TripDetails({
  plan,
  setPlan,
  ctx,
  today,
  markFlag,
}: {
  plan: Plan;
  setPlan: SetPlan;
  ctx: BuilderContext;
  today: string;
  markFlag: (k: keyof Omit<ChatFlags, "pending" | "nightsUnknown">) => void;
}) {
  const [childrenText, setChildrenText] = useState(plan.guest.children.join(", "));
  // Only decides how the section STARTS (open for a new guest); after that the
  // user opens and closes it. Tying it to the name would snap it shut while typing.
  const [guestStartsOpen] = useState(!plan.guest.name);
  useEffect(() => setChildrenText(plan.guest.children.join(", ")), [plan.guest.children]);

  const setGuest = (patch: Partial<Plan["guest"]>) => setPlan((p) => ({ ...p, guest: { ...p.guest, ...patch } }));
  const setStop = (i: number, patch: Partial<PlanStop>) => setPlan((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const places = ctx.locations.filter((l) => l.type !== "property");
  const vehicleTypes = commonVehicles(ctx);
  const emailError = plan.guest.email && !EMAIL_RE.test(plan.guest.email) ? "This email address does not look right." : null;
  const dateError = plan.arrival_date < today ? "This date is in the past." : null;

  function move(i: number, d: -1 | 1) {
    setPlan((p) => {
      const s = [...p.stops];
      const j = i + d;
      if (j < 0 || j >= s.length) return p;
      [s[i], s[j]] = [s[j], s[i]];
      return { ...p, stops: s };
    });
  }

  return (
    <div className="space-y-3">
      <details className={`${ui.card} group`} open={guestStartsOpen}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-olive-800">Guest</span>
            <span className="block truncate text-xs text-sand-500">
              {plan.guest.name || "No name yet"} &middot; {plan.guest.adults} adult{plan.guest.adults === 1 ? "" : "s"}
              {plan.guest.children.length ? `, ${plan.guest.children.length} child${plan.guest.children.length === 1 ? "" : "ren"}` : ""} &middot; {plan.guest.rooms} room{plan.guest.rooms === 1 ? "" : "s"}
              {plan.guest.country ? ` \u00b7 ${countryName(plan.guest.country)}` : ""}
            </span>
          </span>
          <Icon name="chevronLeft" className="h-4 w-4 shrink-0 -rotate-90 text-sand-500 transition group-open:rotate-90" />
        </summary>
        <div className="grid gap-3 border-t border-sand-200 p-4 sm:grid-cols-2">
          <Field label="Guest name" required wide>
            <input className={ui.inputSm} value={plan.guest.name} onChange={(e) => setGuest({ name: e.target.value })} placeholder="e.g. Judy & Cathy Miller" />
          </Field>
          <Field label="Nationality">
            <CountrySelect
              value={plan.guest.country}
              onChange={(code) => setGuest({ country: code, nationality: code === "IN" ? "indian" : "foreign", ...(plan.guest.phone ? {} : { phone_country: code || "IN" }) })}
            />
          </Field>
          <Field label="Email" error={emailError}>
            <input className={ui.inputSm} type="email" value={plan.guest.email} onChange={(e) => setGuest({ email: e.target.value.trim() })} />
          </Field>
          <Field label="Mobile" wide>
            <PhoneField value={plan.guest.phone} country={plan.guest.phone_country || plan.guest.country || "IN"} onChange={(phone, cc) => setGuest({ phone, phone_country: cc })} />
          </Field>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <Field label="Adults" required>
              <input
                className={ui.inputSm}
                type="number"
                min={1}
                value={plan.guest.adults}
                onChange={(e) => {
                  setGuest({ adults: Math.max(1, Math.min(50, Number(e.target.value) || 1)) });
                  markFlag("adultsSet");
                }}
              />
            </Field>
            <Field label="Rooms" required>
              <input
                className={ui.inputSm}
                type="number"
                min={1}
                value={plan.guest.rooms}
                onChange={(e) => {
                  setGuest({ rooms: Math.max(1, Math.min(30, Number(e.target.value) || 1)) });
                  markFlag("roomsSet");
                }}
              />
            </Field>
            <Field label="Kids' ages">
              <input
                className={ui.inputSm}
                value={childrenText}
                placeholder="8, 12"
                onChange={(e) => setChildrenText(e.target.value)}
                onBlur={() => {
                  const ages = childrenText.split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 18);
                  setGuest({ children: ages });
                  setChildrenText(ages.join(", "));
                }}
              />
            </Field>
          </div>
          <Field label="Source">
            <select className={`${ui.select} w-full !py-2`} value={plan.guest.source} onChange={(e) => setGuest({ source: e.target.value })}>
              <option value="">- Choose -</option>
              {SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          {plan.guest.source === "Travel agent" ? (
            <Field label="Agent name">
              <input className={ui.inputSm} value={plan.guest.agent_name} onChange={(e) => setGuest({ agent_name: e.target.value })} />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Internal notes" wide>
            <textarea className={ui.inputSm} rows={2} value={plan.guest.notes} onChange={(e) => setGuest({ notes: e.target.value })} placeholder="Preferences, occasions, dietary needs" />
          </Field>
        </div>
      </details>

      <details className={`${ui.card} group`} open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-olive-800">Route</span>
            <span className="block truncate text-xs text-sand-500">
              {plan.stops.length
                ? plan.stops.map((s) => `${ctx.pricing.parks.find((p) => p.id === s.park_id)?.name.split(/[ -]/)[0] ?? "?"} ${s.nights}N`).join(" + ")
                : "No parks yet"}
            </span>
          </span>
          <Icon name="chevronLeft" className="h-4 w-4 shrink-0 -rotate-90 text-sand-500 transition group-open:rotate-90" />
        </summary>
        <div className="space-y-3 border-t border-sand-200 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Arrival date" required error={dateError}>
            <input
              className={ui.inputSm}
              type="date"
              value={plan.arrival_date}
              onChange={(e) => {
                if (!e.target.value) return;
                setPlan((p) => ({ ...p, arrival_date: e.target.value }));
                markFlag("dateSet");
              }}
            />
          </Field>
          {vehicleTypes.length > 0 ? (
            <Field label="Transfer vehicle">
              <select className={`${ui.select} w-full`} value={plan.vehicle_type ?? ""} onChange={(e) => setPlan((p) => ({ ...p, vehicle_type: e.target.value || null }))}>
                <option value="">Cheapest for the group</option>
                {vehicleTypes.map((v) => <option key={v}>{v}</option>)}
              </select>
            </Field>
          ) : (
            <div />
          )}
          <Field label="Arriving at">
            <select
              className={`${ui.select} w-full`}
              value={plan.arrival_location_id ?? ""}
              onChange={(e) => {
                setPlan((p) => ({ ...p, arrival_location_id: e.target.value || null }));
                markFlag("arrivalAsked");
              }}
            >
              <option value="">On their own (no pick-up)</option>
              {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Leaving from">
            <select className={`${ui.select} w-full`} value={plan.departure_location_id ?? ""} onChange={(e) => setPlan((p) => ({ ...p, departure_location_id: e.target.value || null }))}>
              <option value="">On their own (no drop)</option>
              {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="space-y-2">
          <p className={ui.label}>Parks, in travel order</p>
          {plan.stops.length === 0 && <p className={ui.empty + " !p-4"}>No parks yet. Tell the assistant, or add one below.</p>}
          {plan.stops.map((s, i) => {
            const lodges = lodgesInPark(ctx, s.park_id);
            const rooms = s.property_id ? roomsOf(ctx, s.property_id) : [];
            const meals = s.room_category_id ? mealPlansOf(ctx, s.room_category_id) : [];
            const parkName = ctx.pricing.parks.find((p) => p.id === s.park_id)?.name ?? "Park";
            return (
              <div key={`${s.park_id}-${i}`} className="space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-olive-800">{i + 1}. {parkName}</span>
                  <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1.5 text-xs text-sand-600">
                      Nights
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={s.nights}
                        onChange={(e) => setStop(i, { nights: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                        className="w-14 rounded-md border border-sand-300 bg-white px-2 py-1 text-sm"
                        aria-label={`Nights in ${parkName}`}
                      />
                    </label>
                    <button type="button" className="rounded p-1 text-sand-500 hover:bg-sand-200 disabled:opacity-40" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">
                      <Icon name="chevronLeft" className="h-4 w-4 rotate-90" />
                    </button>
                    <button type="button" className="rounded p-1 text-sand-500 hover:bg-sand-200 disabled:opacity-40" disabled={i === plan.stops.length - 1} onClick={() => move(i, 1)} aria-label="Move later">
                      <Icon name="chevronLeft" className="h-4 w-4 -rotate-90" />
                    </button>
                    <button type="button" className="rounded p-1 text-error hover:bg-error-bg" onClick={() => setPlan((p) => ({ ...p, stops: p.stops.filter((_, j) => j !== i) }))} aria-label={`Remove ${parkName}`}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    className={`${ui.select} w-full !py-1.5 text-xs`}
                    value={s.property_id}
                    onChange={(e) => {
                      const room = roomsOf(ctx, e.target.value)[0];
                      setStop(i, { property_id: e.target.value, room_category_id: room?.id ?? "", meal_plan: room ? mealPlansOf(ctx, room.id)[0] ?? "AP" : "AP" });
                    }}
                    aria-label="Lodge"
                  >
                    {!lodges.length && <option value="">No lodge in this park</option>}
                    {lodges.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <select
                    className={`${ui.select} w-full !py-1.5 text-xs`}
                    value={s.room_category_id}
                    onChange={(e) => {
                      const m = mealPlansOf(ctx, e.target.value);
                      setStop(i, { room_category_id: e.target.value, meal_plan: m.includes(s.meal_plan) ? s.meal_plan : m[0] ?? "AP" });
                    }}
                    aria-label="Room"
                  >
                    {!rooms.length && <option value="">No rooms</option>}
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <select className={`${ui.select} w-full !py-1.5 text-xs`} value={s.meal_plan} onChange={(e) => setStop(i, { meal_plan: e.target.value })} aria-label="Meal plan">
                    {(meals.length ? meals : [s.meal_plan]).map((m) => <option key={m} value={m}>{MEAL_LABEL[m] ?? m}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          <select
            className={`${ui.select} w-full`}
            value=""
            onChange={(e) => e.target.value && setPlan((p) => ({ ...p, stops: [...p.stops, defaultStop(ctx, e.target.value, 2)] }))}
            aria-label="Add a park"
          >
            <option value="">+ Add a park</option>
            {ctx.pricing.parks.filter((p) => lodgesInPark(ctx, p.id).length).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* nights in a city and flights, usually picked up by the trip assistant */}
        {((plan.city_stays ?? []).length > 0 || (plan.flights ?? []).length > 0) && (
          <div className="space-y-2">
            <p className={ui.label}>City nights and flights</p>
            {(plan.city_stays ?? []).map((c, i) => (
              <div key={`c${i}`} className="flex items-center gap-2 rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm">
                <span className="flex-1">
                  {c.city}, {c.when === "before" ? "before the safari" : "at the end"}
                </span>
                <label className="flex items-center gap-1.5 text-xs text-sand-600">
                  Nights
                  <input
                    type="number"
                    min={1}
                    max={14}
                    value={c.nights}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(14, Number(e.target.value) || 1));
                      setPlan((p) => ({ ...p, city_stays: (p.city_stays ?? []).map((x, j) => (j === i ? { ...x, nights: n } : x)) }));
                    }}
                    className="w-14 rounded-md border border-sand-300 bg-white px-2 py-1 text-sm"
                    aria-label={`Nights in ${c.city}`}
                  />
                </label>
                <button type="button" className="rounded p-1 text-error hover:bg-error-bg" onClick={() => setPlan((p) => ({ ...p, city_stays: (p.city_stays ?? []).filter((_, j) => j !== i) }))} aria-label={`Remove the ${c.city} nights`}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ))}
            {(plan.flights ?? []).map((fl, i) => (
              <div key={`f${i}`} className="flex items-center gap-2 rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm">
                <span className="flex-1">
                  Flight {fl.from} to {fl.to}
                  {fl.time ? <span className="text-sand-500"> at {fl.time}</span> : null}
                </span>
                <button type="button" className="rounded p-1 text-error hover:bg-error-bg" onClick={() => setPlan((p) => ({ ...p, flights: (p.flights ?? []).filter((_, j) => j !== i) }))} aria-label={`Remove the flight ${fl.from} to ${fl.to}`}>
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ))}
            <p className="text-xs text-sand-500">Airline, flight number and PNR are added on the flight itself, on Plan &amp; price.</p>
          </div>
        )}
        </div>
      </details>
    </div>
  );
}
