// Server-only: flight booking details (PNR, ticket, times, status) typed by the
// team after the guest confirms. Kept apart from the itinerary versions, so a
// saved quote never changes; the guest page shows them over the planned flight.
// Uses the service-role client: callers must check access to the query first.
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanItem } from "@/lib/sales/plan/types";

export const FLIGHT_STATUSES = ["planned", "on_hold", "confirmed", "cancelled"] as const;
export type FlightStatus = (typeof FLIGHT_STATUSES)[number];
export const FLIGHT_STATUS_LABEL: Record<FlightStatus, string> = { planned: "Planned", on_hold: "On hold", confirmed: "Confirmed", cancelled: "Cancelled" };

export interface FlightBooking {
  item_id: string;
  airline: string;
  flight_no: string;
  depart_time: string;
  arrive_time: string;
  pnr: string;
  ticket_no: string;
  status: FlightStatus;
  notes: string;
  updated_at: string | null;
}

// Booking details by flight item id ({} if the table does not exist yet).
export async function loadFlightBookings(queryId: string): Promise<Record<string, FlightBooking>> {
  const { data, error } = await createAdminClient().from("sales_flight_bookings").select("*").eq("query_id", queryId);
  if (error || !data) return {};
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return Object.fromEntries(
    (data as Record<string, unknown>[]).map((r) => [
      s(r.item_id),
      {
        item_id: s(r.item_id),
        airline: s(r.airline),
        flight_no: s(r.flight_no),
        depart_time: s(r.depart_time),
        arrive_time: s(r.arrive_time),
        pnr: s(r.pnr),
        ticket_no: s(r.ticket_no),
        status: (FLIGHT_STATUSES as readonly string[]).includes(s(r.status)) ? (s(r.status) as FlightStatus) : "planned",
        notes: s(r.notes),
        updated_at: r.updated_at ? s(r.updated_at) : null,
      },
    ])
  );
}

// The flight as the guest should see it: the booking details over the plan's.
export function withBooking(it: PlanItem, b: FlightBooking | undefined): PlanItem {
  if (!it.flight || !b || b.status === "cancelled") return it;
  return {
    ...it,
    flight: {
      ...it.flight,
      airline: b.airline || it.flight.airline,
      number: b.flight_no || it.flight.number,
      time: b.depart_time || it.flight.time,
      arrive: b.arrive_time || it.flight.arrive,
      // only a confirmed flight shows its PNR (and so drops "subject to availability")
      pnr: b.status === "confirmed" && b.pnr ? b.pnr : it.flight.pnr,
    },
  };
}
