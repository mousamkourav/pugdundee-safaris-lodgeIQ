import { monthRange } from "@/lib/format";

export type Summary = {
  month: string;
  label: string;
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
  payrollNet: number;
  purchasesTotal: number;
  lowStock: number;
  overdue: number;
  tripadvisor: number | null;
  google: number | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getMonthlySummary(
  supabase: any,
  lodgeId: string,
  month: string
): Promise<Summary> {
  const { start, end, label } = monthRange(month);
  const inMonth = (t: string, dateCol: string) =>
    supabase
      .from(t)
      .select("*")
      .eq("lodge_id", lodgeId)
      .gte(dateCol, start)
      .lt(dateCol, end);

  const [
    occ,
    extras,
    exp,
    energy,
    vlogs,
    pay,
    purch,
    barItems,
    stockItems,
    assets,
    services,
    ratings,
  ] = await Promise.all([
    inMonth("occupancy_daily", "entry_date"),
    inMonth("extra_sales", "entry_date"),
    inMonth("expenses", "entry_date"),
    inMonth("energy_readings", "entry_date"),
    inMonth("vehicle_logs", "entry_date"),
    supabase.from("payroll").select("net_payable").eq("lodge_id", lodgeId).eq("month", start),
    inMonth("purchases", "purchase_date"),
    supabase.from("bar_items").select("current_stock,reorder_level").eq("lodge_id", lodgeId),
    supabase.from("stock_items").select("current_qty,reorder_level").eq("lodge_id", lodgeId),
    supabase.from("assets").select("id,criticality").eq("lodge_id", lodgeId),
    supabase
      .from("service_records")
      .select("asset_id,next_due,service_date")
      .eq("lodge_id", lodgeId)
      .order("service_date", { ascending: false }),
    inMonth("ratings", "entry_date"),
  ]);

  const sum = (rows: any[] | null, f: (r: any) => number) =>
    (rows ?? []).reduce((s, r) => s + f(r), 0);

  const occRows = occ.data ?? [];
  const roomsPaid = sum(occRows, (r) => Number(r.rooms_paid || 0));
  const roomsComp = sum(occRows, (r) => Number(r.rooms_comp || 0));
  const roomNights = roomsPaid + roomsComp;
  const pax = sum(occRows, (r) => Number(r.total_pax || 0));

  const extrasTotal = sum(extras.data, (r) => Number(r.amount || 0));

  const expRows = exp.data ?? [];
  const catSum = (c: string) =>
    sum(expRows.filter((r: any) => r.category === c), (r) => Number(r.amount || 0));
  const fnb = catSum("fnb");
  const misc = catSum("misc");
  const hk = catSum("housekeeping");
  const totalExpenses = fnb + misc + hk;

  const energyCost = sum(energy.data, (r) => Number(r.cost_rs || 0));
  const fuelLitres = sum(energy.data, (r) => Number(r.fuel_litres || 0));
  const vehicleCost = sum(vlogs.data, (r) => Number(r.cost_rs || 0));
  const vehicleKm = sum(vlogs.data, (r) => Number(r.run_km || 0));
  const payrollNet = sum(pay.data, (r) => Number(r.net_payable || 0));
  const purchasesTotal = sum(purch.data, (r) => Number(r.amount || 0));

  const lowStock =
    (barItems.data ?? []).filter(
      (i: any) => Number(i.current_stock) <= Number(i.reorder_level)
    ).length +
    (stockItems.data ?? []).filter(
      (i: any) => Number(i.current_qty) <= Number(i.reorder_level)
    ).length;

  const latest = new Map<string, any>();
  for (const s of services.data ?? [])
    if (!latest.has(s.asset_id)) latest.set(s.asset_id, s);
  const today = new Date().toISOString().slice(0, 10);
  let overdue = 0;
  for (const a of assets.data ?? []) {
    const last = latest.get(a.id);
    if (last?.next_due && Date.parse(last.next_due) < Date.parse(today)) overdue++;
  }

  let tripadvisor: number | null = null;
  let google: number | null = null;
  const rsorted = (ratings.data ?? []).sort((a: any, b: any) =>
    String(b.entry_date).localeCompare(String(a.entry_date))
  );
  for (const r of rsorted) {
    if (r.source === "tripadvisor" && tripadvisor === null)
      tripadvisor = Number(r.score);
    if (r.source === "google" && google === null) google = Number(r.score);
  }

  return {
    month,
    label,
    roomsPaid,
    roomsComp,
    roomNights,
    pax,
    extrasTotal,
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
    payrollNet,
    purchasesTotal,
    lowStock,
    overdue,
    tripadvisor,
    google,
  };
}
