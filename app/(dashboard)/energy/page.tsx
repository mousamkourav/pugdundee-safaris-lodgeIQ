import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L, labelize, DeleteBtn } from "@/components/form-bits";
import { addEnergy, deleteEnergy } from "./actions";

const ASSETS = ["dg_125", "dg_30", "electricity", "solar"];

export default async function EnergyPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Energy" />;

  const { start, end, label } = monthRange(month);
  const supabase = await createClient();
  const { data } = await supabase
    .from("energy_readings")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date");

  const rows = (data ?? []) as Array<Record<string, number | string | null>>;
  const totalCost = rows.reduce((s, r) => s + Number(r.cost_rs || 0), 0);
  const totalFuel = rows.reduce((s, r) => s + Number(r.fuel_litres || 0), 0);

  return (
    <div>
      <PageHeader
        title="Energy"
        description={`DG sets, electricity & solar for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <KpiCard label="Energy cost" value={inr(totalCost)} />
        <KpiCard label="Fuel used (L)" value={Math.round(totalFuel)} />
      </div>

      <form
        action={addEnergy}
        className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4 lg:grid-cols-8"
      >
        <input type="hidden" name="lodge_id" value={lodge} />
        <input type="hidden" name="month" value={month} />
        <L label="Date">
          <input required type="date" name="entry_date" className={inp} />
        </L>
        <L label="Asset">
          <select name="asset" className={inp}>
            {ASSETS.map((a) => (
              <option key={a} value={a}>
                {labelize(a)}
              </option>
            ))}
          </select>
        </L>
        <L label="Opening">
          <input type="number" step="0.01" name="opening" className={inp} />
        </L>
        <L label="Closing">
          <input type="number" step="0.01" name="closing" className={inp} />
        </L>
        <L label="Fuel (L)">
          <input type="number" step="0.01" name="fuel_litres" className={inp} />
        </L>
        <L label="Cost (₹)">
          <input type="number" step="0.01" name="cost_rs" className={inp} />
        </L>
        <L label="Rate/L">
          <input type="number" step="0.01" name="rate_per_ltr" className={inp} />
        </L>
        <div className="flex items-end">
          <button className={btn}>Add</button>
        </div>
      </form>

      <DataTable
        columns={[
          { key: "date", label: "Date" },
          { key: "asset", label: "Asset" },
          { key: "net", label: "Net usage", className: "tabular" },
          { key: "fuel", label: "Fuel (L)", className: "tabular" },
          { key: "cost", label: "Cost", className: "text-right tabular" },
          { key: "act", label: "", className: "text-right" },
        ]}
        rows={rows.map((r) => ({
          date: r.entry_date,
          asset: labelize(String(r.asset)),
          net: r.net_usage ?? "—",
          fuel: r.fuel_litres ?? "—",
          cost: inr(Number(r.cost_rs || 0)),
          act: (
            <DeleteBtn
              action={deleteEnergy}
              id={String(r.id)}
              lodge={lodge}
              month={month}
            />
          ),
        }))}
        empty="No energy readings this month yet."
      />
    </div>
  );
}
