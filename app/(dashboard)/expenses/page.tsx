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
import { addExpense, deleteExpense } from "./actions";

const CATEGORIES = [
  { value: "fnb", label: "F&B" },
  { value: "misc", label: "Misc" },
  { value: "housekeeping", label: "Housekeeping" },
];

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Expenses" />;

  const { start, end, label } = monthRange(month);
  const supabase = await createClient();

  const { data: exp } = await supabase
    .from("expenses")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date");
  const { data: occ } = await supabase
    .from("occupancy_daily")
    .select("rooms_paid,rooms_comp,total_pax")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end);

  const rows = (exp ?? []) as Array<Record<string, number | string>>;
  const occRows = (occ ?? []) as Array<Record<string, number>>;
  const pax = occRows.reduce((s, r) => s + Number(r.total_pax || 0), 0);
  const roomNights = occRows.reduce(
    (s, r) => s + Number(r.rooms_paid || 0) + Number(r.rooms_comp || 0),
    0
  );

  const totalBy = (cat: string) =>
    rows.filter((r) => r.category === cat).reduce((s, r) => s + Number(r.amount || 0), 0);
  const fnb = totalBy("fnb");
  const misc = totalBy("misc");
  const hk = totalBy("housekeeping");

  const perPax = pax ? Math.round(fnb / pax) : null;
  const perRoom = roomNights ? Math.round(fnb / roomNights) : null;

  return (
    <div>
      <PageHeader
        title="Expenses"
        description={`F&B, misc & housekeeping for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      <div className="mb-2 grid gap-3 sm:grid-cols-3">
        <KpiCard label="F&B" value={inr(fnb)} />
        <KpiCard label="Misc" value={inr(misc)} />
        <KpiCard label="Housekeeping" value={inr(hk)} />
      </div>
      <p className="mb-8 text-sm text-sand-500">
        {perPax !== null
          ? `F&B cost per guest ${inr(perPax)} · per room ${inr(perRoom)} (from this month's occupancy).`
          : "Add occupancy for this month to see F&B cost per guest and per room."}
      </p>

      <form
        action={addExpense}
        className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <input type="hidden" name="lodge_id" value={lodge} />
        <input type="hidden" name="month" value={month} />
        <L label="Date">
          <input required type="date" name="entry_date" className={inp} />
        </L>
        <L label="Category">
          <select name="category" className={inp}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </L>
        <L label="Line item">
          <input required name="line_item" placeholder="e.g. Vegetables" className={inp} />
        </L>
        <L label="Amount (₹)">
          <input type="number" step="0.01" name="amount" defaultValue={0} className={inp} />
        </L>
        <L label="Remarks">
          <input name="remarks" className={inp} />
        </L>
        <div className="flex items-end">
          <button className={btn}>Add</button>
        </div>
      </form>

      <DataTable
        columns={[
          { key: "date", label: "Date" },
          { key: "category", label: "Category" },
          { key: "item", label: "Line item" },
          { key: "amount", label: "Amount", className: "text-right tabular" },
          { key: "act", label: "", className: "text-right" },
        ]}
        rows={rows.map((r) => ({
          date: r.entry_date,
          category: labelize(String(r.category)),
          item: r.line_item,
          amount: inr(Number(r.amount)),
          act: (
            <DeleteBtn
              action={deleteExpense}
              id={String(r.id)}
              lodge={lodge}
              month={month}
            />
          ),
        }))}
        empty="No expenses recorded this month yet."
      />
    </div>
  );
}
