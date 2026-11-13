"use client";

// More than one room type at a lodge ("1 AC Cottage + 1 AC Treehouse"), on the Confirm step under
// the lodge's room. Each room type: its rooms, the adults and the children in them. The guests in
// the room types must add up to the trip's (checked here and again when it is priced).
import type { BuilderContext, Plan, PlanStop } from "@/lib/sales/plan/types";
import { roomsOf } from "@/lib/sales/plan/planner";
import { addRoomType, hasMix, mixProblems, setMixEntry } from "@/lib/sales/plan/room-mix";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";

const ages = (t: string) =>
  t
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 17)
    .slice(0, 20);

export function RoomMixEditor({ plan, ctx, i, change }: { plan: Plan; ctx: BuilderContext; i: number; change: (u: (p: Plan) => Plan) => void }) {
  const s = plan.stops[i];
  const rooms = roomsOf(ctx, s.property_id);
  if (plan.group || rooms.length < 2) return null; // a group quote: one room type per lodge (its own costing)
  const setStop = (u: (st: PlanStop) => PlanStop) => change((p) => ({ ...p, stops: p.stops.map((x, k) => (k === i ? u(x) : x)) }));
  const lodge = ctx.properties.find((x) => x.id === s.property_id)?.name ?? "This lodge";
  if (!hasMix(s)) {
    const other = rooms.find((r) => r.id !== s.room_category_id);
    return (
      <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={() => other && setStop((st) => addRoomType(st, plan.guest, other.id))}>
        <Icon name="plus" className="h-3.5 w-3.5" />
        Another room type here
      </button>
    );
  }
  const problems = mixProblems(s, plan.guest, ctx, lodge);
  return (
    <div className="w-full space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-2" aria-label={`Room types at ${lodge}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-sand-500">Room types at {lodge}</p>
      {s.room_mix!.map((m, k) => (
        <div key={k} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Room</span>
            <select className={`${ui.select} !py-1.5 text-xs`} value={m.room_category_id} onChange={(e) => setStop((st) => setMixEntry(st, k, { room_category_id: e.target.value }))} aria-label={`Room type ${k + 1}`}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Rooms</span>
            <input type="number" min={1} max={20} className={`${ui.inputSm} w-16`} value={m.rooms} onChange={(e) => setStop((st) => setMixEntry(st, k, { rooms: Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1))) }))} aria-label={`Rooms of type ${k + 1}`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Adults</span>
            <input type="number" min={0} max={40} className={`${ui.inputSm} w-16`} value={m.adults} onChange={(e) => setStop((st) => setMixEntry(st, k, { adults: Math.max(0, Math.min(40, Math.floor(Number(e.target.value) || 0))) }))} aria-label={`Adults in room type ${k + 1}`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={ui.label}>Kids&apos; ages</span>
            <input key={`${k}-${m.children.join(",")}`} className={`${ui.inputSm} w-24`} defaultValue={m.children.join(", ")} placeholder="none" onBlur={(e) => setStop((st) => setMixEntry(st, k, { children: ages(e.target.value) }))} aria-label={`Children in room type ${k + 1}`} />
          </label>
          <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={() => setStop((st) => setMixEntry(st, k, "remove"))} aria-label={`Remove room type ${k + 1}`}>
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={() => setStop((st) => addRoomType(st, plan.guest, rooms.find((r) => !st.room_mix?.some((m) => m.room_category_id === r.id))?.id ?? rooms[0].id))}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          Another room type
        </button>
        {problems.length ? (
          <span className="text-xs font-medium text-error">{problems[0]}</span>
        ) : (
          <span className="text-xs text-success">
            {s.room_mix!.reduce((t, m) => t + m.rooms, 0)} rooms for {plan.guest.adults} adult{plan.guest.adults === 1 ? "" : "s"}
            {plan.guest.children.length ? ` and ${plan.guest.children.length} child${plan.guest.children.length === 1 ? "" : "ren"}` : ""}: each room type priced at its own rate
          </span>
        )}
      </div>
    </div>
  );
}
