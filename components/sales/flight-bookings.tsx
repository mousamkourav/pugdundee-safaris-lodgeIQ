"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui, Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { saveFlightBooking } from "@/app/(dashboard)/sales/queries/[id]/actions";

export interface FlightRowIn {
  itemId: string;
  day: number;
  date: string; // readable
  from: string;
  to: string;
  planned: { airline: string; number: string; time: string; arrive: string };
  booking: { airline: string; flight_no: string; depart_time: string; arrive_time: string; pnr: string; ticket_no: string; status: string; notes: string } | null;
}

const STATUS: { value: string; label: string; tone: "neutral" | "warning" | "success" | "error" }[] = [
  { value: "planned", label: "Planned", tone: "neutral" },
  { value: "on_hold", label: "On hold", tone: "warning" },
  { value: "confirmed", label: "Confirmed", tone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "error" },
];

// Flight booking details for the team, typed after the guest confirms. The guest
// itinerary shows a confirmed flight with its PNR instead of "subject to availability".
export function FlightBookings({ queryId, flights, canEdit }: { queryId: string; flights: FlightRowIn[]; canEdit: boolean }) {
  return (
    <section className={`${ui.card} p-5`}>
      <h2 className="text-lg">Flights</h2>
      <p className="mt-1 text-xs text-sand-500">Booking details for the team. A confirmed flight shows on the guest itinerary with its PNR; the quote itself does not change.</p>
      <ul className="mt-4 space-y-3">
        {flights.map((f) => (
          <FlightRow key={f.itemId} queryId={queryId} f={f} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  );
}

function FlightRow({ queryId, f, canEdit }: { queryId: string; f: FlightRowIn; canEdit: boolean }) {
  const router = useRouter();
  const start = () => ({
    airline: f.booking?.airline || f.planned.airline,
    flight_no: f.booking?.flight_no || f.planned.number,
    depart_time: f.booking?.depart_time || f.planned.time,
    arrive_time: f.booking?.arrive_time || f.planned.arrive,
    pnr: f.booking?.pnr ?? "",
    ticket_no: f.booking?.ticket_no ?? "",
    status: f.booking?.status ?? "planned",
    notes: f.booking?.notes ?? "",
  });
  const [form, setForm] = useState(start);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const st = STATUS.find((s) => s.value === (f.booking?.status ?? "planned"))!;
  const set = (k: keyof ReturnType<typeof start>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((x) => ({ ...x, [k]: e.target.value }));

  function save() {
    setError(null);
    startSave(async () => {
      try {
        const res = await saveFlightBooking(queryId, f.itemId, form);
        if (res.error) setError(res.error);
        else {
          setOpen(false);
          router.refresh();
        }
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  const b = f.booking;
  return (
    <li className="rounded-lg border border-sand-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-olive-800">
            <Icon name="send" className="mr-1.5 inline h-4 w-4 text-olive-600" />
            {f.from} to {f.to}
            <span className="ml-2 text-xs font-normal text-sand-500">Day {f.day}{f.date ? ` \u00b7 ${f.date}` : ""}</span>
          </p>
          <p className="text-xs text-sand-600">
            {[form.airline && form.flight_no ? `${form.airline} ${form.flight_no}` : form.airline || form.flight_no, form.depart_time && `${form.depart_time}${form.arrive_time ? ` - ${form.arrive_time}` : ""}`, b?.pnr && `PNR ${b.pnr}`, b?.ticket_no && `Ticket ${b.ticket_no}`]
              .filter(Boolean)
              .join(" \u00b7 ") || "No flight details yet"}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          {canEdit && !open && (
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => { setForm(start()); setOpen(true); }}>
              <Icon name="edit" className="h-4 w-4" />
              Booking details
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-sand-100 pt-3">
          {error && <p className={ui.alertError}>{error}</p>}
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="block text-xs text-sand-600">Airline<input className={`${ui.inputSm} mt-1`} value={form.airline} onChange={set("airline")} /></label>
            <label className="block text-xs text-sand-600">Flight no.<input className={`${ui.inputSm} mt-1`} value={form.flight_no} onChange={set("flight_no")} /></label>
            <label className="block text-xs text-sand-600">Take-off<input className={`${ui.inputSm} mt-1`} type="time" value={form.depart_time} onChange={set("depart_time")} /></label>
            <label className="block text-xs text-sand-600">Landing<input className={`${ui.inputSm} mt-1`} type="time" value={form.arrive_time} onChange={set("arrive_time")} /></label>
            <label className="block text-xs text-sand-600">PNR<input className={`${ui.inputSm} mt-1 uppercase`} value={form.pnr} onChange={set("pnr")} /></label>
            <label className="block text-xs text-sand-600">Ticket no.<input className={`${ui.inputSm} mt-1`} value={form.ticket_no} onChange={set("ticket_no")} /></label>
            <label className="block text-xs text-sand-600">
              Status
              <select className={`${ui.select} mt-1 w-full !py-2`} value={form.status} onChange={set("status")}>
                {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block text-xs text-sand-600">Notes (internal)<input className={`${ui.inputSm} mt-1`} value={form.notes} onChange={set("notes")} /></label>
          </div>
          <div className="flex gap-2">
            <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={saving} onClick={save}>{saving ? "Saving..." : "Save"}</button>
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}
