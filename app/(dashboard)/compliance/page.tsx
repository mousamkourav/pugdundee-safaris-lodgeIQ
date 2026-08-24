import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L } from "@/components/form-bits";
import { addDocument, deleteDocument, renewDocument } from "./actions";

type Doc = {
  id: string;
  doc_type: string;
  title: string;
  authority: string | null;
  reference_no: string | null;
  issue_date: string | null;
  expiry_date: string;
  notes: string | null;
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
}

const STATUS_META: Record<string, { t: string; cls: string }> = {
  expired: { t: "Expired", cls: "bg-error-bg text-error" },
  due_soon: { t: "Expiring soon", cls: "bg-warning-bg text-warning" },
  ok: { t: "Valid", cls: "bg-success-bg text-success" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs ${s.cls}`}>{s.t}</span>
  );
}

function RowActions({
  id,
  lodge,
  expiry,
}: {
  id: string;
  lodge: string;
  expiry: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <form action={renewDocument} className="flex items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="lodge_id" value={lodge} />
        <input
          type="date"
          name="expiry_date"
          defaultValue={expiry}
          className="rounded-lg border border-sand-300 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-gold-500"
        />
        <button className="text-xs text-olive-700 hover:underline">Renew</button>
      </form>
      <form action={deleteDocument} className="inline">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="lodge_id" value={lodge} />
        <button className="text-xs text-error hover:underline">Delete</button>
      </form>
    </div>
  );
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  if (!lodge) return <NoLodge title="Insurances & licences" />;

  const supabase = await createClient();
  const { data } = await supabase
    .from("compliance_documents")
    .select("*")
    .eq("lodge_id", lodge)
    .order("expiry_date", { ascending: true });

  const docs = (data ?? []) as Doc[];

  const rank: Record<string, number> = { expired: 0, due_soon: 1, ok: 2 };
  const withStatus = docs.map((d) => {
    const days = daysUntil(d.expiry_date);
    let key: string;
    if ((days as number) < 0) key = "expired";
    else if ((days as number) <= 30) key = "due_soon";
    else key = "ok";
    return { d, days, key };
  });
  withStatus.sort((x, y) =>
    rank[x.key] !== rank[y.key]
      ? rank[x.key] - rank[y.key]
      : (x.days ?? 99999) - (y.days ?? 99999)
  );

  const expired = withStatus.filter((s) => s.key === "expired").length;
  const dueSoon = withStatus.filter((s) => s.key === "due_soon").length;

  return (
    <div>
      <PageHeader
        title="Insurances & licences"
        description="Track policy and licence expiry per lodge. Alerts fire 30 days before expiry."
      />
      <LodgePicker lodges={lodges} lodge={lodge} />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Expired" value={expired} />
        <KpiCard label="Expiring soon (≤30d)" value={dueSoon} />
        <KpiCard label="Documents tracked" value={docs.length} />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg">Add a document</h2>
        <form
          action={addDocument}
          className="grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-4"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <L label="Type">
            <select name="doc_type" className={inp}>
              <option value="insurance">Insurance</option>
              <option value="licence">Licence</option>
            </select>
          </L>
          <L label="Title">
            <input
              required
              name="title"
              placeholder="Fire safety licence"
              className={inp}
            />
          </L>
          <L label="Issuer / authority">
            <input name="authority" placeholder="State fire dept." className={inp} />
          </L>
          <L label="Policy / licence no.">
            <input name="reference_no" placeholder="Optional" className={inp} />
          </L>
          <L label="Issue date">
            <input type="date" name="issue_date" className={inp} />
          </L>
          <L label="Expiry date">
            <input required type="date" name="expiry_date" className={inp} />
          </L>
          <L label="Notes">
            <input name="notes" placeholder="Optional" className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add document</button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg">Documents</h2>
        <DataTable
          columns={[
            { key: "type", label: "Type" },
            { key: "title", label: "Title" },
            { key: "authority", label: "Issuer" },
            { key: "ref", label: "Ref no." },
            { key: "expiry", label: "Expiry" },
            { key: "days", label: "Days", className: "tabular" },
            { key: "status", label: "Status" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={withStatus.map((s) => ({
            type: s.d.doc_type === "licence" ? "Licence" : "Insurance",
            title: s.d.title,
            authority: s.d.authority ?? "—",
            ref: s.d.reference_no ?? "—",
            expiry: s.d.expiry_date,
            days:
              s.days === null
                ? "—"
                : s.days < 0
                ? `${Math.abs(s.days)} over`
                : s.days,
            status: <StatusBadge status={s.key} />,
            act: <RowActions id={s.d.id} lodge={lodge} expiry={s.d.expiry_date} />,
          }))}
          empty="No documents yet. Add insurances and licences above to track expiry."
        />
      </section>
    </div>
  );
}
