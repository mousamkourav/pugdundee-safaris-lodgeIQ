import { createClient } from "@/lib/supabase/server";

export type Metrics = {
  lodgeId: string;
  lodgeName: string;
  month: string; // YYYY-MM-01
  roomNights: number;
  pax: number;
  extras: number;
  fnb: number;
  fnbPerPax: number;
  misc: number;
  hk: number;
  totalCost: number;
  energyCost: number;
  safaris: number;
  rating: number | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

// Reads all monthly submissions the current user may see (RLS scopes managers to
// their own lodge; admins see all) and flattens them into comparable metrics.
export async function fetchMetrics(): Promise<Metrics[]> {
  const s = await createClient();
  const { data } = await s
    .from("monthly_submissions")
    .select("lodge_id, month, data, lodges(name)")
    .order("month");
  const rows = (data ?? []) as any[];
  return rows.map((r) => {
    const d = r.data ?? {};
    const front = d.front ?? {};
    const roomNights =
      n(front.total_rooms) || n(front.paid_rooms) + n(front.comp_rooms);
    const energyCost = Array.isArray(d.energy)
      ? d.energy.reduce((t: number, e: any) => t + n(e.cost), 0)
      : 0;
    const fnb = n(d.fnb?.total);
    const misc = n(d.misc?.total);
    const hk = n(d.housekeeping?.total);
    const lodgeName = Array.isArray(r.lodges)
      ? r.lodges[0]?.name
      : r.lodges?.name;
    return {
      lodgeId: r.lodge_id,
      lodgeName: lodgeName ?? "Lodge",
      month: String(r.month).slice(0, 10),
      roomNights,
      pax: n(front.total_pax),
      extras: n(front.extra_total),
      fnb,
      fnbPerPax: n(d.fnb?.per_pax),
      misc,
      hk,
      totalCost: fnb + misc + hk,
      energyCost,
      safaris: n(d.safari?.total_safaris),
      rating: front.ta_rating ? n(front.ta_rating) : null,
    };
  });
}

export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---- range aggregation (used by the dashboard calendar presets) ----
// Collapse many monthly rows into one row per lodge: totals are summed, and
// averages are recomputed from the summed inputs (not averaged) so they stay
// correct over a range. `rating` uses the most recent month's value in the set.
export function aggregateByLodge(rows: Metrics[]): Metrics[] {
  const byLodge = new Map<string, Metrics[]>();
  for (const m of rows) {
    if (!byLodge.has(m.lodgeName)) byLodge.set(m.lodgeName, []);
    byLodge.get(m.lodgeName)!.push(m);
  }
  const out: Metrics[] = [];
  for (const [lodgeName, list] of byLodge) {
    const sum = (pick: (x: Metrics) => number) =>
      list.reduce((t, x) => t + pick(x), 0);
    const pax = sum((x) => x.pax);
    const fnb = sum((x) => x.fnb);
    const latest = [...list].sort((a, b) => b.month.localeCompare(a.month))[0];
    out.push({
      lodgeId: latest.lodgeId,
      lodgeName,
      month: latest.month,
      roomNights: sum((x) => x.roomNights),
      pax,
      extras: sum((x) => x.extras),
      fnb,
      fnbPerPax: pax ? Math.round(fnb / pax) : 0,
      misc: sum((x) => x.misc),
      hk: sum((x) => x.hk),
      totalCost: sum((x) => x.totalCost),
      energyCost: sum((x) => x.energyCost),
      safaris: sum((x) => x.safaris),
      rating: latest.rating,
    });
  }
  return out.sort((a, b) => b.extras - a.extras);
}

// ---- per-room normalisation (lodges differ in room count) ----
// Given an (aggregated or single-month) metric row, compute per-room figures.
// roomNights is the denominator; guards against divide-by-zero.
export type PerRoom = {
  extrasPerRoom: number;
  fnbPerRoom: number;
  miscPerRoom: number;
  hkPerRoom: number;
  totalExpenses: number; // = fnb + misc + hk (same as totalCost)
  totalExpPerRoom: number;
};

export function perRoom(m: Metrics): PerRoom {
  const rn = m.roomNights || 0;
  const per = (v: number) => (rn ? Math.round(v / rn) : 0);
  const totalExpenses = m.fnb + m.misc + m.hk;
  return {
    extrasPerRoom: per(m.extras),
    fnbPerRoom: per(m.fnb),
    miscPerRoom: per(m.misc),
    hkPerRoom: per(m.hk),
    totalExpenses,
    totalExpPerRoom: per(totalExpenses),
  };
}
