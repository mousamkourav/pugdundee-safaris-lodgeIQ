import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L, labelize } from "@/components/form-bits";
import {
  addBarItem,
  updateBarRate,
  deleteBarItem,
  addBarMovement,
} from "./actions";

const MOVE_TYPES = ["purchase", "sale", "wastage", "transfer", "adjustment"];

type Item = {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  current_rate: number;
  current_stock: number;
  reorder_level: number;
};

export default async function BarPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  if (!lodge) return <NoLodge title="Bar / liquor" />;

  const s = await createClient();
  const { data: itemsData } = await s
    .from("bar_items")
    .select("*")
    .eq("lodge_id", lodge)
    .order("name");
  const { data: histData } = await s
    .from("bar_rate_history")
    .select("*")
    .eq("lodge_id", lodge)
    .order("changed_at", { ascending: false });
  const { data: moveData } = await s
    .from("bar_stock_movements")
    .select("*")
    .eq("lodge_id", lodge)
    .order("date", { ascending: false });

  const items = (itemsData ?? []) as Item[];
  const hist = (histData ?? []) as Array<Record<string, number | string>>;
  const moves = (moveData ?? []) as Array<Record<string, number | string>>;
  const itemName = (id: string) =>
    items.find((i) => i.id === id)?.name ?? "—";
  const lowStock = items.filter(
    (i) => Number(i.current_stock) <= Number(i.reorder_level)
  ).length;

  return (
    <div>
      <PageHeader
        title="Bar / liquor"
        description="Liquor stock and rates. Changing a rate notifies management automatically."
      />
      <LodgePicker lodges={lodges} lodge={lodge} />

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <KpiCard label="Items" value={items.length} />
        <KpiCard label="Low stock" value={lowStock} />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Items</h2>
        <form
          action={addBarItem}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <L label="Name">
            <input required name="name" className={inp} />
          </L>
          <L label="Category">
            <input name="category" placeholder="Whisky / Beer" className={inp} />
          </L>
          <L label="Unit">
            <input name="unit" placeholder="bottle / peg" className={inp} />
          </L>
          <L label="Rate (₹)">
            <input type="number" name="current_rate" defaultValue={0} className={inp} />
          </L>
          <L label="Stock">
            <input type="number" name="current_stock" defaultValue={0} className={inp} />
          </L>
          <L label="Reorder level">
            <input type="number" name="reorder_level" defaultValue={0} className={inp} />
          </L>
          <div className="lg:col-span-6">
            <button className={btn} style={{ maxWidth: 160 }}>
              Add item
            </button>
          </div>
        </form>

        <DataTable
          columns={[
            { key: "name", label: "Item" },
            { key: "stock", label: "Stock", className: "tabular" },
            { key: "rate", label: "Rate", className: "tabular" },
            { key: "newrate", label: "Update rate" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={items.map((i) => ({
            name: (
              <span>
                {i.name}
                {Number(i.current_stock) <= Number(i.reorder_level) && (
                  <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning">
                    Low
                  </span>
                )}
              </span>
            ),
            stock: `${i.current_stock}${i.unit ? " " + i.unit : ""}`,
            rate: inr(Number(i.current_rate)),
            newrate: (
              <form action={updateBarRate} className="flex items-center gap-2">
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input
                  type="number"
                  name="current_rate"
                  defaultValue={Number(i.current_rate)}
                  className="w-24 rounded-lg border border-sand-300 px-2 py-1 text-sm"
                />
                <button className="text-xs text-olive-700 hover:underline">
                  Save
                </button>
              </form>
            ),
            act: (
              <form action={deleteBarItem} className="inline">
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <button className="text-xs text-error hover:underline">
                  Delete
                </button>
              </form>
            ),
          }))}
          empty="No bar items yet."
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Stock movements</h2>
        {items.length > 0 && (
          <form
            action={addBarMovement}
            className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-5"
          >
            <input type="hidden" name="lodge_id" value={lodge} />
            <L label="Item">
              <select name="item_id" className={inp}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </L>
            <L label="Type">
              <select name="type" className={inp}>
                {MOVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {labelize(t)}
                  </option>
                ))}
              </select>
            </L>
            <L label="Qty">
              <input type="number" step="0.01" name="qty" defaultValue={0} className={inp} />
            </L>
            <L label="Date">
              <input required type="date" name="date" className={inp} />
            </L>
            <div className="flex items-end">
              <button className={btn}>Add</button>
            </div>
          </form>
        )}
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "item", label: "Item" },
            { key: "type", label: "Type" },
            { key: "qty", label: "Qty", className: "text-right tabular" },
          ]}
          rows={moves.slice(0, 20).map((m) => ({
            date: m.date,
            item: itemName(String(m.item_id)),
            type: labelize(String(m.type)),
            qty: m.qty,
          }))}
          empty="No movements yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg">Rate change history</h2>
        <DataTable
          columns={[
            { key: "when", label: "When" },
            { key: "item", label: "Item" },
            { key: "old", label: "Old", className: "text-right tabular" },
            { key: "new", label: "New", className: "text-right tabular" },
          ]}
          rows={hist.slice(0, 20).map((h) => ({
            when: String(h.changed_at).slice(0, 10),
            item: itemName(String(h.item_id)),
            old: inr(Number(h.old_rate || 0)),
            new: inr(Number(h.new_rate || 0)),
          }))}
          empty="No rate changes yet."
        />
      </section>
    </div>
  );
}
