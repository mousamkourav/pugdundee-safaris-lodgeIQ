import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Doc = {
  id: string;
  doc_type: string | null;
  title: string;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
};

function splitNotes(notes: string | null): { cat: string; text: string | null } {
  if (!notes) return { cat: "Other", text: null };
  const m = notes.match(/^\[([^\]]+)\]\s?(.*)$/);
  if (m) return { cat: m[1], text: m[2] || null };
  return { cat: "Other", text: notes };
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
}

function status(valid_to: string | null): { t: string; cls: string; rank: number } {
  const d = daysUntil(valid_to);
  if (d === null) return { t: "No date", cls: "bg-sand-100 text-sand-600", rank: 3 };
  if (d < 0) return { t: "Expired", cls: "bg-error-bg text-error", rank: 0 };
  if (d <= 30) return { t: `${d}d left`, cls: "bg-error-bg text-error", rank: 1 };
  if (d <= 90) return { t: `${d}d left`, cls: "bg-warning-bg text-warning", rank: 2 };
  return { t: "Valid", cls: "bg-success-bg text-success", rank: 4 };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
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

  const s = await createClient();
  const { data: rows } = await s
    .from("compliance_documents")
    .select("id, doc_type, title, issue_date, expiry_date, notes")
    .eq("lodge_id", lodge)
    .order("expiry_date", { ascending: true, nullsFirst: false });

  const docs = (rows as Doc[]) ?? [];
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";

  // summary counts
  const expired = docs.filter((d) => {
    const n = daysUntil(d.expiry_date);
    return n !== null && n < 0;
  }).length;
  const soon = docs.filter((d) => {
    const n = daysUntil(d.expiry_date);
    return n !== null && n >= 0 && n <= 30;
  }).length;

  // group by category
  const cats = Array.from(new Set(docs.map((d) => splitNotes(d.notes).cat)));
  const order = ["License", "Insurance", "AMC", "Fitness", "Pollution", "Other"];
  cats.sort((a, b) => (order.indexOf(a) + 100) - (order.indexOf(b) + 100));

  return (
    <div>
      <PageHeader
        title="Insurances & licences"
        description={`${lodgeName} · ${docs.length} documents`}
      />

      <div className="mb-6">
        <LodgePicker lodges={lodges} lodge={lodge} />
      </div>

      {(expired > 0 || soon > 0) && (
        <div className="mb-6 flex flex-wrap gap-3">
          {expired > 0 && (
            <span className="rounded-lg bg-error-bg px-4 py-2 text-sm text-error">
              {expired} expired
            </span>
          )}
          {soon > 0 && (
            <span className="rounded-lg bg-warning-bg px-4 py-2 text-sm text-warning">
              {soon} expiring within 30 days
            </span>
          )}
        </div>
      )}

      {docs.length === 0 ? (
        <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sand-500">
          No documents recorded for {lodgeName} yet.
        </div>
      ) : (
        <div className="space-y-6">
          {cats.map((cat) => {
            const items = docs
              .filter((d) => splitNotes(d.notes).cat === cat)
              .sort((a, b) => status(a.expiry_date).rank - status(b.expiry_date).rank);
            return (
              <section
                key={cat}
                className="overflow-hidden rounded-xl border border-sand-200 bg-white"
              >
                <h3 className="border-b border-sand-200 bg-sand-50 px-5 py-3 text-sm font-semibold text-sand-800">
                  {cat}
                  <span className="ml-2 text-xs font-normal text-sand-400">
                    {items.length}
                  </span>
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-sand-200 text-left text-xs text-sand-500">
                        <th className="px-5 py-2 font-medium">Document</th>
                        <th className="px-3 py-2 font-medium">Valid from</th>
                        <th className="px-3 py-2 font-medium">Valid to</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-5 py-2 font-medium">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((d) => {
                        const st = status(d.expiry_date);
                        return (
                          <tr key={d.id} className="border-b border-sand-100 last:border-0">
                            <td className="px-5 py-2 text-sand-800">{d.title}</td>
                            <td className="px-3 py-2 text-sand-600">{fmtDate(d.issue_date)}</td>
                            <td className="px-3 py-2 text-sand-600">{fmtDate(d.expiry_date)}</td>
                            <td className="px-3 py-2">
                              <span className={`rounded-full px-2.5 py-0.5 text-xs ${st.cls}`}>
                                {st.t}
                              </span>
                            </td>
                            <td className="px-5 py-2 text-sand-500">{splitNotes(d.notes).text ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
