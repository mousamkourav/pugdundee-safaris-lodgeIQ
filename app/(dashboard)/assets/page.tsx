import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L, labelize } from "@/components/form-bits";
import { addAsset, deleteAsset, recordService, deleteService } from "./actions";

type Asset = {
  id: string;
  name: string;
  category: string | null;
  criticality: string;
  service_interval_months: number | null;
};
type Svc = {
  id: string;
  asset_id: string;
  service_date: string;
  next_due: string | null;
  notes: string | null;
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
}

const STATUS_META: Record<string, { t: string; cls: string }> = {
  overdue: { t: "Overdue", cls: "bg-error-bg text-error" },
  due_soon: { t: "Due soon", cls: "bg-warning-bg text-warning" },
  ok: { t: "OK", cls: "bg-success-bg text-success" },
  none: { t: "No service", cls: "bg-sand-100 text-sand-600" },
  tracked: { t: "Tracked", cls: "bg-info-bg text-info" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs ${s.cls}`}>{s.t}</span>
  );
}

function DelForm({
  action,
  id,
  lodge,
  label = "Delete",
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  lodge: string;
  label?: string;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lodge_id" value={lodge} />
      <button className="text-xs text-error hover:underline">{label}</button>
    </form>
  );
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  if (!lodge) return <NoLodge title="Assets & service log" />;

  const supabase = await createClient();
  const { data: assetsData } = await supabase
    .from("assets")
    .select("*")
    .eq("lodge_id", lodge)
    .order("name");
  const { data: svcData } = await supabase
    .from("service_records")
    .select("*")
    .eq("lodge_id", lodge)
    .order("service_date", { ascending: false });

  const assets = (assetsData ?? []) as Asset[];
  const services = (svcData ?? []) as Svc[];
  const assetName = (id: string) =>
    assets.find((a) => a.id === id)?.name ?? "—";

  // latest service per asset
  const latest = new Map<string, Svc>();
  for (const s of services) if (!latest.has(s.asset_id)) latest.set(s.asset_id, s);

  const rank: Record<string, number> = {
    overdue: 0,
    none: 1,
    due_soon: 2,
    tracked: 3,
    ok: 4,
  };

  const status = assets.map((a) => {
    const last = latest.get(a.id) ?? null;
    const nextDue = last?.next_due ?? null;
    const days = daysUntil(nextDue);
    let key: string;
    if (!last) key = "none";
    else if (nextDue === null) key = "tracked";
    else if ((days as number) < 0) key = "overdue";
    else if ((days as number) <= 30) key = "due_soon";
    else key = "ok";
    return { a, last, nextDue, days, key };
  });

  status.sort((x, y) => {
    if (rank[x.key] !== rank[y.key]) return rank[x.key] - rank[y.key];
    const sx = x.a.criticality === "safety" ? 0 : 1;
    const sy = y.a.criticality === "safety" ? 0 : 1;
    if (sx !== sy) return sx - sy;
    return (x.days ?? 99999) - (y.days ?? 99999);
  });

  const overdue = status.filter((s) => s.key === "overdue").length;
  const dueSoon = status.filter((s) => s.key === "due_soon").length;

  return (
    <div>
      <PageHeader
        title="Assets & service log"
        description="Track servicing for every asset. Safety items are prioritised."
      />
      <LodgePicker lodges={lodges} lodge={lodge} />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Overdue" value={overdue} />
        <KpiCard label="Due soon (≤30d)" value={dueSoon} />
        <KpiCard label="Assets tracked" value={assets.length} />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Service status</h2>
        <DataTable
          columns={[
            { key: "asset", label: "Asset" },
            { key: "crit", label: "Criticality" },
            { key: "last", label: "Last service" },
            { key: "due", label: "Next due" },
            { key: "days", label: "Days", className: "tabular" },
            { key: "status", label: "Status" },
          ]}
          rows={status.map((s) => ({
            asset: s.a.name,
            crit:
              s.a.criticality === "safety" ? (
                <span className="rounded-full bg-error-bg px-2 py-0.5 text-xs text-error">
                  Safety
                </span>
              ) : (
                <span className="text-sand-500">Normal</span>
              ),
            last: s.last?.service_date ?? "—",
            due: s.nextDue ?? "—",
            days:
              s.days === null
                ? "—"
                : s.days < 0
                ? `${Math.abs(s.days)} over`
                : s.days,
            status: <StatusBadge status={s.key} />,
          }))}
          empty="No assets yet. Add assets below to start tracking servicing."
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Assets</h2>
        <form
          action={addAsset}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <L label="Asset name">
            <input required name="name" placeholder="Fire Extinguisher" className={inp} />
          </L>
          <L label="Category">
            <input name="category" placeholder="Fire safety" className={inp} />
          </L>
          <L label="Criticality">
            <select name="criticality" className={inp}>
              <option value="normal">Normal</option>
              <option value="safety">Safety</option>
            </select>
          </L>
          <L label="Service every (months)">
            <input type="number" name="service_interval_months" placeholder="12" className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add asset</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "name", label: "Asset" },
            { key: "category", label: "Category" },
            { key: "crit", label: "Criticality" },
            { key: "interval", label: "Interval" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={assets.map((a) => ({
            name: a.name,
            category: a.category ?? "—",
            crit: labelize(a.criticality),
            interval: a.service_interval_months
              ? `${a.service_interval_months} mo`
              : "—",
            act: <DelForm action={deleteAsset} id={a.id} lodge={lodge} />,
          }))}
          empty="No assets yet."
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg">Record a service</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-sand-500">Add an asset first to log a service.</p>
        ) : (
          <>
            <form
              action={recordService}
              className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
            >
              <input type="hidden" name="lodge_id" value={lodge} />
              <L label="Asset">
                <select name="asset_id" className={inp}>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Service date">
                <input required type="date" name="service_date" className={inp} />
              </L>
              <L label="Notes">
                <input name="notes" className={inp} />
              </L>
              <div className="flex items-end">
                <button className={btn}>Record</button>
              </div>
            </form>
            <DataTable
              columns={[
                { key: "asset", label: "Asset" },
                { key: "date", label: "Serviced" },
                { key: "due", label: "Next due" },
                { key: "notes", label: "Notes" },
                { key: "act", label: "", className: "text-right" },
              ]}
              rows={services.slice(0, 20).map((s) => ({
                asset: assetName(s.asset_id),
                date: s.service_date,
                due: s.next_due ?? "—",
                notes: s.notes ?? "—",
                act: <DelForm action={deleteService} id={s.id} lodge={lodge} />,
              }))}
              empty="No services recorded yet."
            />
          </>
        )}
      </section>
    </div>
  );
}
