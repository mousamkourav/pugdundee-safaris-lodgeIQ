"use client";

// "Build with a form": the trip added one entry at a time (stops, city nights, flights),
// with no reading involved. The guest, dates and arrival / departure points stay in the
// panel on the right; the route is checked on the Confirm step like any other trip.
import { useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { lodgesInPark, roomsOf } from "@/lib/sales/plan/planner";
import { formAddCityNight, formAddFlight, formAddStop, formExperiences, formStopProblems } from "@/lib/sales/plan/form";
import { cityHotels, safariOnly } from "@/lib/sales/plan/cities";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";

type SetPlan = (u: (p: Plan) => Plan) => void;

export function TripForm({ plan, setPlan, ctx }: { plan: Plan; setPlan: SetPlan; ctx: BuilderContext }) {
  const safari = safariOnly(ctx);
  const parks = safari.pricing.parks.filter((p) => lodgesInPark(safari, p.id).length);
  const hotels = cityHotels(ctx);
  const lodgeName = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? "";

  // ---- a stop
  const [park, setPark] = useState("");
  const [lodge, setLodge] = useState("");
  const [room, setRoom] = useState("");
  const [nights, setNights] = useState("2");
  const [safaris, setSafaris] = useState("");
  const [naturalists, setNaturalists] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [stopError, setStopError] = useState<string[]>([]);
  const pickPark = (id: string) => {
    setPark(id);
    const l = lodgesInPark(ctx, id)[0];
    setLodge(l?.id ?? "");
    setRoom(l ? roomsOf(ctx, l.id)[0]?.id ?? "" : "");
    setExtras([]);
  };
  const pickLodge = (id: string) => {
    setLodge(id);
    setRoom(roomsOf(ctx, id)[0]?.id ?? "");
    setExtras([]);
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  function addStop() {
    const s = {
      park_id: park,
      property_id: lodge,
      room_category_id: room,
      nights: Number(nights),
      safaris: num(safaris),
      naturalists: naturalists === "all" ? -1 : num(naturalists),
      addon_ids: extras,
    };
    const problems = formStopProblems(ctx, s);
    setStopError(problems);
    if (problems.length) return;
    setPlan((p) => formAddStop(p, ctx, s));
    setPark("");
    setLodge("");
    setRoom("");
    setNights("2");
    setSafaris("");
    setNaturalists("");
    setExtras([]);
  }

  // ---- a city night
  const [city, setCity] = useState("");
  const [hotel, setHotel] = useState("");
  const [cityNights, setCityNights] = useState("1");
  const [after, setAfter] = useState("end"); // "end": after the lodges added so far
  function addCity() {
    setPlan((p) => formAddCityNight(p, { city, hotel, nights: Number(cityNights), after: after === "end" ? p.stops.length : Number(after) }));
    setCity("");
    setHotel("");
    setCityNights("1");
  }

  // ---- a flight
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  function addFlight() {
    setPlan((p) => formAddFlight(p, { from, to, time }));
    setFrom(to);
    setTo("");
    setTime("");
  }

  const positions = [
    { v: "end", label: plan.stops.length ? "Next (after the last lodge so far)" : "Before the first lodge" },
    ...(plan.stops.length ? [{ v: "0", label: "Before the first lodge" }] : []),
    ...plan.stops.slice(0, -1).map((s, i) => ({ v: String(i + 1), label: `After ${lodgeName(s.property_id) || `stop ${i + 1}`}` })),
  ];

  return (
    <section className={`${ui.card} space-y-5 p-4`} aria-label="Build the trip with a form">
      <div>
        <h2 className="text-lg">Build with a form</h2>
        <p className="text-sm text-sand-500">Add the trip in order: city nights, flights and lodges. Guest, dates, and where they arrive and leave are on the right.</p>
      </div>

      {/* ---------------- a lodge ---------------- */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-olive-800">Add a lodge</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <select className={ui.select} value={park} onChange={(e) => pickPark(e.target.value)} aria-label="Park">
            <option value="">Park</option>
            {parks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className={ui.select} value={lodge} onChange={(e) => pickLodge(e.target.value)} disabled={!park} aria-label="Lodge">
            {!park && <option value="">Lodge</option>}
            {park && lodgesInPark(ctx, park).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className={ui.select} value={room} onChange={(e) => setRoom(e.target.value)} disabled={!lodge} aria-label="Room">
            {!lodge && <option value="">Room</option>}
            {lodge && roomsOf(ctx, lodge).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className={ui.label}>Nights</span>
            <input type="number" min={1} max={30} className={ui.input} value={nights} onChange={(e) => setNights(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={ui.label}>Safaris (empty = all that fit)</span>
            <input type="number" min={0} max={30} className={ui.input} value={safaris} onChange={(e) => setSafaris(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={ui.label}>With a naturalist</span>
            <select className={ui.select} value={naturalists} onChange={(e) => setNaturalists(e.target.value)}>
              <option value="">None</option>
              <option value="all">All of them</option>
              {Array.from({ length: Math.max(0, Math.min(10, Number(safaris) || 6)) }, (_, i) => i + 1).map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
          </label>
        </div>
        {lodge && formExperiences(ctx, lodge).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className={ui.label}>Experiences:</span>
            {formExperiences(ctx, lodge).map((a) => (
              <label key={a.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={extras.includes(a.id)} onChange={(e) => setExtras((x) => (e.target.checked ? [...x, a.id] : x.filter((y) => y !== a.id)))} />
                {a.name}
              </label>
            ))}
          </div>
        )}
        {stopError.length > 0 && <p className="text-xs text-error">{stopError.join(" ")}</p>}
        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={addStop}>
          <Icon name="plus" className="h-4 w-4" />
          Add the lodge
        </button>
      </fieldset>

      {/* ---------------- a city night ---------------- */}
      <fieldset className="space-y-2 border-t border-sand-200 pt-4">
        <legend className="text-sm font-semibold text-olive-800">Add city nights</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className={ui.input} placeholder="City (Delhi)" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" list="lq-form-cities" />
          <input className={ui.input} placeholder="Hotel (empty = to be confirmed)" value={hotel} onChange={(e) => setHotel(e.target.value)} aria-label="Hotel" list="lq-form-hotels" />
          <input type="number" min={1} max={30} className={ui.input} value={cityNights} onChange={(e) => setCityNights(e.target.value)} aria-label="Nights" />
          <select className={ui.select} value={after} onChange={(e) => setAfter(e.target.value)} aria-label="Where in the trip">
            {positions.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
          </select>
        </div>
        <datalist id="lq-form-cities">{[...new Set(hotels.map((h) => h.city))].map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="lq-form-hotels">{hotels.filter((h) => !city || h.city.toLowerCase().startsWith(city.toLowerCase())).map((h) => <option key={h.name} value={h.name} />)}</datalist>
        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={addCity} disabled={!city.trim()}>
          <Icon name="plus" className="h-4 w-4" />
          Add the city nights
        </button>
      </fieldset>

      {/* ---------------- a flight ---------------- */}
      <fieldset className="space-y-2 border-t border-sand-200 pt-4">
        <legend className="text-sm font-semibold text-olive-800">Add a flight</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={ui.input} placeholder="From (Delhi)" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Flight from" />
          <input className={ui.input} placeholder="To (Jabalpur)" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Flight to" />
          <input type="time" className={ui.input} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Departure time (optional)" />
        </div>
        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={addFlight} disabled={!from.trim() || !to.trim()}>
          <Icon name="plus" className="h-4 w-4" />
          Add the flight
        </button>
      </fieldset>

      <p className="border-t border-sand-200 pt-3 text-xs text-sand-500">
        So far: {plan.stops.length} lodge{plan.stops.length === 1 ? "" : "s"}, {(plan.city_stays ?? []).length} city stay{(plan.city_stays ?? []).length === 1 ? "" : "s"}, {(plan.flights ?? []).length} flight{(plan.flights ?? []).length === 1 ? "" : "s"}.
        Change or remove them under Route on the right, then check everything on the Confirm step.
      </p>
    </section>
  );
}
