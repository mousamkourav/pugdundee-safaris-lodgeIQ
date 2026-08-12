import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L, DeleteBtn } from "@/components/form-bits";
import { addVehicle, addVehicleLog, deleteVehicleLog } from "./actions";

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Vehicles" />;

  const { start, end, label } = monthRange(month);
  const supabase = await createClient();

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("*")
    .eq("lodge_id", lodge)
    .order("vehicle_no");
  const { data: logs } = await supabase
    .from("vehicle_logs")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date");

  const vehicleRows = (vehicles ?? []) as Array<Record<string, string>>;
  const logRows = (logs ?? []) as Array<Record<string, number | string>>;
  const vName = (id: string) => {
    const v = vehicleRows.find((x) => x.id === id);
    return v ? v.label || v.vehicle_no : "—";
  };

  return (
    <div>
      <PageHeader
        title="Vehicles"
        description={`Fleet and fuel logs for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Vehicles</h2>
        <form
          action={addVehicle}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Vehicle no.">
            <input required name="vehicle_no" placeholder="MH 34 ..." className={inp} />
          </L>
          <L label="Label">
            <input name="label" placeholder="Gypsy / Isuzu / Bike" className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add vehicle</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "no", label: "Vehicle no." },
            { key: "label", label: "Label" },
          ]}
          rows={vehicleRows.map((v) => ({
            no: v.vehicle_no,
            label: v.label || "—",
          }))}
          empty="No vehicles added yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg">Fuel & running logs</h2>
        {vehicleRows.length === 0 ? (
          <p className="text-sm text-sand-500">Add a vehicle first to log runs.</p>
        ) : (
          <>
            <form
              action={addVehicleLog}
              className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-7"
            >
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <L label="Date">
                <input required type="date" name="entry_date" className={inp} />
              </L>
              <L label="Vehicle">
                <select name="vehicle_id" className={inp}>
                  {vehicleRows.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label || v.vehicle_no}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Opening km">
                <input type="number" step="0.1" name="opening_km" className={inp} />
              </L>
              <L label="Closing km">
                <input type="number" step="0.1" name="closing_km" className={inp} />
              </L>
              <L label="Fuel (L)">
                <input type="number" step="0.01" name="fuel_ltr" className={inp} />
              </L>
              <L label="Cost (₹)">
                <input type="number" step="0.01" name="cost_rs" className={inp} />
              </L>
              <div className="flex items-end">
                <button className={btn}>Add</button>
              </div>
            </form>
            <DataTable
              columns={[
                { key: "date", label: "Date" },
                { key: "vehicle", label: "Vehicle" },
                { key: "run", label: "Run km", className: "tabular" },
                { key: "fuel", label: "Fuel (L)", className: "tabular" },
                { key: "cost", label: "Cost", className: "text-right tabular" },
                { key: "perkm", label: "₹/km", className: "text-right tabular" },
                { key: "act", label: "", className: "text-right" },
              ]}
              rows={logRows.map((r) => {
                const run = Number(r.run_km || 0);
                const cost = Number(r.cost_rs || 0);
                return {
                  date: r.entry_date,
                  vehicle: vName(String(r.vehicle_id)),
                  run: run || "—",
                  fuel: r.fuel_ltr ?? "—",
                  cost: inr(cost),
                  perkm: run ? inr(Math.round(cost / run)) : "—",
                  act: (
                    <DeleteBtn
                      action={deleteVehicleLog}
                      id={String(r.id)}
                      lodge={lodge}
                      month={month}
                    />
                  ),
                };
              })}
              empty="No vehicle logs this month yet."
            />
          </>
        )}
      </section>
    </div>
  );
}
