import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L } from "@/components/form-bits";
import {
  addStockItem,
  deleteStockItem,
  addPurchase,
  deletePurchase,
} from "./actions";

type StockItem = {
  id: string;
  name: string;
  unit: string | null;
  current_qty: number;
  reorder_level: number;
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Stock & purchases" />;

  const { start, end, label } = monthRange(month);
  const s = await createClient();

  const { data: itemsData } = await s
    .from("stock_items")
    .select("*")
    .eq("lodge_id", lodge)
    .order("name");
  const { data: purData } = await s
    .from("purchases")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("purchase_date", start)
    .lt("purchase_date", end)
    .order("purchase_date", { ascending: false });

  const items = (itemsData ?? []) as StockItem[];
  const purchases = (purData ?? []) as Array<Record<string, number | string | null>>;
  const itemName = (id: string | null) =>
    items.find((i) => i.id === id)?.name ?? null;

  // signed URLs for bills (private bucket, service-role)
  const billIds = purchases
    .map((p) => p.bill_attachment_id)
    .filter(Boolean) as string[];
  const billUrls = new Map<string, string>();
  if (billIds.length) {
    const admin = createAdminClient();
    const { data: atts } = await admin
      .from("attachments")
      .select("id,file_path")
      .in("id", billIds);
    for (const a of (atts ?? []) as Array<{ id: string; file_path: string }>) {
      const { data: signed } = await admin.storage
        .from("attachments")
        .createSignedUrl(a.file_path, 3600);
      if (signed?.signedUrl) billUrls.set(a.id, signed.signedUrl);
    }
  }

  const purchaseTotal = purchases.reduce(
    (t, p) => t + Number(p.amount || 0),
    0
  );
  const lowStock = items.filter(
    (i) => Number(i.current_qty) <= Number(i.reorder_level)
  ).length;

  return (
    <div>
      <PageHeader
        title="Stock & purchases"
        description={`Store items and purchases for ${label}. Upload bills with each purchase.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Purchases (month)" value={inr(purchaseTotal)} />
        <KpiCard label="Stock items" value={items.length} />
        <KpiCard label="Low stock" value={lowStock} />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Stock items</h2>
        <form
          action={addStockItem}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Name">
            <input required name="name" className={inp} />
          </L>
          <L label="Category">
            <input name="category" className={inp} />
          </L>
          <L label="Unit">
            <input name="unit" placeholder="kg / pc" className={inp} />
          </L>
          <L label="Current qty">
            <input type="number" step="0.01" name="current_qty" defaultValue={0} className={inp} />
          </L>
          <L label="Reorder level">
            <input type="number" step="0.01" name="reorder_level" defaultValue={0} className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add item</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "name", label: "Item" },
            { key: "qty", label: "Qty", className: "tabular" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={items.map((i) => ({
            name: (
              <span>
                {i.name}
                {Number(i.current_qty) <= Number(i.reorder_level) && (
                  <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning">
                    Low
                  </span>
                )}
              </span>
            ),
            qty: `${i.current_qty}${i.unit ? " " + i.unit : ""}`,
            act: (
              <form action={deleteStockItem} className="inline">
                <input type="hidden" name="id" value={i.id} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className="text-xs text-error hover:underline">
                  Delete
                </button>
              </form>
            ),
          }))}
          empty="No stock items yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg">Purchases</h2>
        <form
          action={addPurchase}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-7"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date">
            <input required type="date" name="purchase_date" className={inp} />
          </L>
          <L label="Tracked item">
            <select name="item_id" className={inp}>
              <option value="">— none —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </L>
          <L label="Or item name">
            <input name="item_name" placeholder="free text" className={inp} />
          </L>
          <L label="Qty">
            <input type="number" step="0.01" name="qty" defaultValue={0} className={inp} />
          </L>
          <L label="Rate (₹)">
            <input type="number" step="0.01" name="rate" defaultValue={0} className={inp} />
          </L>
          <L label="Bill (image/pdf)">
            <input type="file" name="bill" accept="image/*,application/pdf" className="text-xs" />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "item", label: "Item" },
            { key: "qty", label: "Qty", className: "tabular" },
            { key: "amount", label: "Amount", className: "text-right tabular" },
            { key: "bill", label: "Bill" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={purchases.map((p) => {
            const bid = p.bill_attachment_id as string | null;
            const url = bid ? billUrls.get(bid) : undefined;
            return {
              date: p.purchase_date,
              item: itemName(p.item_id as string | null) ?? p.item_name ?? "—",
              qty: p.qty,
              amount: inr(Number(p.amount || 0)),
              bill: url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-olive-700 hover:underline"
                >
                  View
                </a>
              ) : (
                "—"
              ),
              act: (
                <form action={deletePurchase} className="inline">
                  <input type="hidden" name="id" value={String(p.id)} />
                  <input type="hidden" name="lodge_id" value={lodge} />
                  <input type="hidden" name="month" value={month} />
                  <button className="text-xs text-error hover:underline">
                    Delete
                  </button>
                </form>
              ),
            };
          })}
          empty="No purchases this month yet."
        />
      </section>
    </div>
  );
}
