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
import {
  addOccupancy,
  deleteOccupancy,
  addExtraSale,
  deleteExtraSale,
} from "./actions";

const EXTRA_ITEMS = [
  "nature_shop",
  "spa",
  "beverages_soft",
  "beverages_alcohol",
  "corkage",
  "laundry",
  "extra_food",
  "activities",
  "transport",
];

export default async function OccupancyPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Occupancy & extras" />;

  const { start, end, label } = monthRange(month);
  const supabase = await createClient();

  const { data: occ } = await supabase
    .from("occupancy_daily")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date");
  const { data: extras } = await supabase
    .from("extra_sales")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date");

  const occRows = (occ ?? []) as Array<Record<string, number | string>>;
  const extraRows = (extras ?? []) as Array<Record<string, number | string>>;
  const roomNights = occRows.reduce(
    (s, r) => s + Number(r.rooms_paid || 0) + Number(r.rooms_comp || 0),
    0
  );
  const pax = occRows.reduce((s, r) => s + Number(r.total_pax || 0), 0);
  const extraTotal = extraRows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Occupancy & extras"
        description={`Daily entries for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Room nights" value={roomNights} />
        <KpiCard label="Total pax" value={pax} />
        <KpiCard label="Extra sales" value={inr(extraTotal)} />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Daily occupancy</h2>
        <form
          action={addOccupancy}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-7"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date">
            <input required type="date" name="entry_date" className={inp} />
          </L>
          <L label="Rooms paid">
            <input type="number" name="rooms_paid" defaultValue={0} className={inp} />
          </L>
          <L label="Rooms comp">
            <input type="number" name="rooms_comp" defaultValue={0} className={inp} />
          </L>
          <L label="Adults">
            <input type="number" name="adults" defaultValue={0} className={inp} />
          </L>
          <L label="Child 5-12">
            <input type="number" name="children_5_12" defaultValue={0} className={inp} />
          </L>
          <L label="Child <5">
            <input type="number" name="children_below_5" defaultValue={0} className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "paid", label: "Paid" },
            { key: "comp", label: "Comp" },
            { key: "pax", label: "Pax" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={occRows.map((r) => ({
            date: r.entry_date,
            paid: r.rooms_paid,
            comp: r.rooms_comp,
            pax: r.total_pax,
            act: (
              <DeleteBtn
                action={deleteOccupancy}
                id={String(r.id)}
                lodge={lodge}
                month={month}
              />
            ),
          }))}
          empty="No occupancy entries this month yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg">Extra sales</h2>
        <form
          action={addExtraSale}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date">
            <input required type="date" name="entry_date" className={inp} />
          </L>
          <L label="Item">
            <select name="line_item" className={inp}>
              {EXTRA_ITEMS.map((i) => (
                <option key={i} value={i}>
                  {labelize(i)}
                </option>
              ))}
            </select>
          </L>
          <L label="Amount (₹)">
            <input type="number" step="0.01" name="amount" defaultValue={0} className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "item", label: "Item" },
            { key: "amount", label: "Amount", className: "text-right tabular" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={extraRows.map((r) => ({
            date: r.entry_date,
            item: labelize(String(r.line_item)),
            amount: inr(Number(r.amount)),
            act: (
              <DeleteBtn
                action={deleteExtraSale}
                id={String(r.id)}
                lodge={lodge}
                month={month}
              />
            ),
          }))}
          empty="No extra sales this month yet."
        />
      </section>
    </div>
  );
}
