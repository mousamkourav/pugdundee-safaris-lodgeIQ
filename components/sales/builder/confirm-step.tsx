"use client";

// "Confirm the trip": what the reader understood, in plain words and in order, with a
// one-click correction on each line. Plan & price opens after "Correct, continue".
import { useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { editStay, editStop, removeFlight, stopChoices, tripSummary, type SummaryLine } from "@/lib/sales/plan/confirm";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";

type SetPlan = (u: (p: Plan) => Plan) => void;

const KIND_ICON: Record<SummaryLine["kind"], string> = {
  guests: "users",
  city: "building",
  lodge: "bed",
  flight: "send",
  transfer: "car",
  note: "alert",
};

export function ConfirmStep({
  plan,
  setPlan,
  ctx,
  onConfirm,
  onEdited,
  confirmed,
}: {
  plan: Plan;
  setPlan: SetPlan;
  ctx: BuilderContext;
  onConfirm: () => void;
  onEdited: () => void; // a correction was made here (the reader learns from it)
  confirmed: boolean;
}) {
  const lines = tripSummary(plan, ctx);
  const [open, setOpen] = useState<string | null>(null); // the line being corrected
  const change = (u: (p: Plan) => Plan) => {
    setPlan(u);
    onEdited();
  };
  const stops = plan.stops.length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className={`${ui.card} overflow-hidden`} aria-label="The trip in plain words">
        <div className="border-b border-sand-200 px-4 py-3">
          <h2 className="text-lg">Confirm the trip</h2>
          <p className="text-sm text-sand-500">Read it line by line. Correct anything that is wrong with Edit; then press &ldquo;Correct, continue&rdquo;. No price is shown until then.</p>
        </div>
        <ol className="divide-y divide-sand-100">
          {lines.map((l, k) => {
            const id = l.stop !== undefined ? `s${l.stop}` : l.stay !== undefined ? `c${l.stay}` : l.flight !== undefined ? `f${l.flight}` : null;
            const editable = id !== null;
            const isOpen = editable && open === id;
            return (
              <li key={k} className={`px-4 py-2.5 text-sm ${l.warn ? "bg-gold-50" : ""} ${l.kind === "lodge" || l.kind === "city" ? "bg-sand-50/60" : ""}`}>
                <div className="flex items-start gap-3">
                  <Icon name={KIND_ICON[l.kind]} className={`mt-0.5 h-4 w-4 shrink-0 ${l.warn ? "text-warning" : "text-sand-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={l.kind === "lodge" || l.kind === "city" || l.kind === "guests" ? "font-semibold text-olive-800" : "text-sand-700"}>{l.text}</p>
                    {l.detail && <p className="text-xs text-sand-500">{l.detail}</p>}
                  </div>
                  {editable && (
                    <button type="button" className={`${ui.btnGhost} ${ui.btnSm} shrink-0`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                      <Icon name="edit" className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </div>

                {/* ---- a lodge: nights, lodge, room, move, remove ---- */}
                {isOpen && l.stop !== undefined && (() => {
                  const i = l.stop;
                  const s = plan.stops[i];
                  const { lodges, rooms } = stopChoices(plan, ctx, i);
                  return (
                    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-sand-200 bg-white p-2 text-xs">
                      <label className="flex flex-col gap-1">
                        <span className={ui.label}>Nights</span>
                        <input type="number" min={1} max={30} className={`${ui.inputSm} w-20`} value={s.nights} onChange={(e) => e.target.value && change((p) => editStop(p, ctx, i, { nights: Number(e.target.value) }))} aria-label="Nights" />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={ui.label}>Lodge</span>
                        <select className={`${ui.select} !py-1.5 text-xs`} value={s.property_id} onChange={(e) => change((p) => editStop(p, ctx, i, { property_id: e.target.value }))} aria-label="Lodge">
                          {lodges.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={ui.label}>Room</span>
                        <select className={`${ui.select} !py-1.5 text-xs`} value={s.room_category_id} onChange={(e) => change((p) => editStop(p, ctx, i, { room_category_id: e.target.value }))} aria-label="Room">
                          {!s.room_category_id && <option value="">Choose a room</option>}
                          {rooms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </label>
                      <span className="flex gap-1">
                        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={i === 0} onClick={() => change((p) => editStop(p, ctx, i, "up"))} aria-label="Move earlier">
                          <Icon name="chevronLeft" className="h-4 w-4 rotate-90" />
                        </button>
                        <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={i === stops - 1} onClick={() => change((p) => editStop(p, ctx, i, "down"))} aria-label="Move later">
                          <Icon name="chevronLeft" className="h-4 w-4 -rotate-90" />
                        </button>
                        <button
                          type="button"
                          className={`${ui.btnDangerOutline} ${ui.btnSm}`}
                          onClick={() => {
                            setOpen(null);
                            change((p) => editStop(p, ctx, i, "remove"));
                          }}
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </span>
                    </div>
                  );
                })()}

                {/* ---- a city night: nights, remove ---- */}
                {isOpen && l.stay !== undefined && (() => {
                  const k2 = l.stay;
                  const c = (plan.city_stays ?? [])[k2];
                  if (!c) return null;
                  return (
                    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-sand-200 bg-white p-2 text-xs">
                      <label className="flex flex-col gap-1">
                        <span className={ui.label}>Nights</span>
                        <input type="number" min={1} max={30} className={`${ui.inputSm} w-20`} value={c.nights} onChange={(e) => e.target.value && change((p) => editStay(p, k2, { nights: Number(e.target.value) }))} aria-label="Nights" />
                      </label>
                      <p className="flex-1 text-sand-500">Change the hotel or the city on the Trip step (Route).</p>
                      <button
                        type="button"
                        className={`${ui.btnDangerOutline} ${ui.btnSm}`}
                        onClick={() => {
                          setOpen(null);
                          change((p) => editStay(p, k2, "remove"));
                        }}
                      >
                        <Icon name="trash" className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  );
                })()}

                {/* ---- a flight: remove ---- */}
                {isOpen && l.flight !== undefined && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-sand-200 bg-white p-2 text-xs">
                    <p className="flex-1 text-sand-500">A flight that is not in the trip can be removed; add a missing one on the Trip step (tell the assistant, or Build with a form).</p>
                    <button
                      type="button"
                      className={`${ui.btnDangerOutline} ${ui.btnSm}`}
                      onClick={() => {
                        setOpen(null);
                        change((p) => removeFlight(p, l.flight!));
                      }}
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                      Remove the flight
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <aside className="space-y-3 lg:sticky lg:top-36 lg:self-start">
        <div className={`${ui.card} space-y-2 p-4 text-sm`}>
          <p className="font-semibold text-olive-800">{confirmed ? "Confirmed" : "Is this the trip?"}</p>
          <p className="text-sand-500">
            {confirmed
              ? "This route was confirmed. Any change to it asks for a new confirmation."
              : "Transfers come from the lodges, city nights and flights above: correct those and the transfers follow."}
          </p>
          <button type="button" className={`${ui.btnPrimary} w-full`} onClick={onConfirm}>
            <Icon name="check" className="h-4 w-4" />
            Correct, continue
          </button>
        </div>
      </aside>
    </div>
  );
}
