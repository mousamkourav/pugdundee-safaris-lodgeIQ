import type { SupabaseClient } from "@supabase/supabase-js";
import { monthRange } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export type SubmissionSummary = {
  label: string;
  hasData: boolean;
  roomsPaid: number;
  roomsComp: number;
  roomNights: number;
  pax: number;
  extrasTotal: number;
  fnb: number;
  misc: number;
  hk: number;
  totalExpenses: number;
  fnbPerPax: number | null;
  fnbPerRoom: number | null;
  energyCost: number;
  fuelLitres: number;
  vehicleCost: number;
  vehicleKm: number;
  safaris: number;
  tripadvisor: number | null;
  google: number | null;
  status: string | null;
};

// Reads the same monthly_submissions JSONB the dashboard uses, so the Monthly
// summary page shows figures consistent with everything else in the app.
export async function getSubmissionSummary(
  supabase: SupabaseClient,
  lodgeId: string,
  month: string // "YYYY-MM"
): Promise<SubmissionSummary> {
  const { start, label } = monthRange(month);

  const { data: row } = await supabase
    .from("monthly_submissions")
    .select("data, status")
    .eq("lodge_id", lodgeId)
    .eq("month", start)
    .maybeSingle();

  const d = (row as any)?.data ?? {};
  const status = (row as any)?.status ?? null;
  const front = d.front ?? {};

  const roomsPaid = n(front.paid_rooms);
  const roomsComp = n(front.comp_rooms);
  const roomNights = n(front.total_rooms) || roomsPaid + roomsComp;
  const pax = n(front.total_pax) || n(front.adults) + n(front.child_5_12);

  const fnb = n(d.fnb?.total);
  const misc = n(d.misc?.total);
  const hk = n(d.housekeeping?.total);
  const totalExpenses = fnb + misc + hk;

  const energy = Array.isArray(d.energy) ? d.energy : [];
  const energyCost = energy.reduce((t: number, e: any) => t + n(e.cost), 0);
  const fuelLitres = energy.reduce((t: number, e: any) => t + n(e.diesel_l), 0);

  const vehicles = Array.isArray(d.vehicles) ? d.vehicles : [];
  const vehicleCost = vehicles.reduce((t: number, v: any) => t + n(v.cost), 0);
  const vehicleKm = vehicles.reduce((t: number, v: any) => t + n(v.total_run), 0);

  return {
    label,
    hasData: !!row,
    roomsPaid,
    roomsComp,
    roomNights,
    pax,
    extrasTotal: n(front.extra_total),
    fnb,
    misc,
    hk,
    totalExpenses,
    fnbPerPax: pax ? Math.round(fnb / pax) : null,
    fnbPerRoom: roomNights ? Math.round(fnb / roomNights) : null,
    energyCost,
    fuelLitres,
    vehicleCost,
    vehicleKm,
    safaris: n(d.safari?.total_safaris),
    tripadvisor: front.ta_rating ? n(front.ta_rating) : null,
    google: front.google_rating ? n(front.google_rating) : null,
    status,
  };
}
