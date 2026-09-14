import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { addDoc, updateDoc, deleteDoc } from "./actions";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Doc = {
  id: string;
  doc_type: string | null;
  title: string;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
};

const CATEGORIES = ["License", "Insurance", "AMC", "Fitness", "Pollution", "Other"];

function splitNotes(notes: string | null): { cat: string; text: string } {
  if (!notes) return { cat: "Other", text: "" };
  const m = notes.match(/^\[([^\]]+)\]\s?(.*)$/);
  if (m) return { cat: m[1], text: m[2] || "" };
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
  // treat the far-future placeholder as "no deadline"
  if (valid_to === "2099-12-31") return { t: "No expiry", cls: "bg-sand-100 text-sand-600", rank: 3 };
  if (d < 0) return { t: "Expired", cls: "bg-error-bg text-error", rank: 0 };
  if (d <= 30) return { t: `${d}d left`, cls: "bg-error-bg text-error", rank: 1 };
  if (d <= 90) return { t: `${d}d left`, cls: "bg-warning-bg text-warning", rank: 2 };
  return { t: "Valid", cls: "bg-success-bg text-success", rank: 4 };
}

function forInput(iso: string | null): string {
  if (!iso || iso === "2099-12-31") return "";
  return iso;
}

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gold-500";

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

  const expired = docs.filter((d) => {
    const n = daysUntil(d.expiry_date);
    return n !== null && n < 0 && d.expiry_date !== "2099-12-31";
  }).length;
  const soon = docs.filter((d) => {
    const n = daysUntil(d.expiry_date);
    return n !== null && n >= 0 && n <= 30;
  }).length;

  const sorted = [...docs].sort(
    (a, b) => status(a.expiry_date).rank - status(b.expiry_date).rank
  );

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

      {/* Add new document */}
      <section className="mb-6 rounded-xl border border-sand-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-sand-800">Add document</h3>
        <form action={addDoc} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input type="hidden" name="lodge" value={lodge} />
          <select name="category" className={inputCls} defaultValue="License">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input name="title" placeholder="Document name" required className={inputCls + " lg:col-span-2"} />
          <input name="issue_date" type="date" title="Valid from" className={inputCls} />
          <input name="expiry_date" type="date" title="Valid to" className={inputCls} />
          <input name="remark" placeholder="Remark / policy no." className={inputCls} />
          <button className="rounded-lg bg-olive-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-olive-700 sm:col-span-2 lg:col-span-6">
            Add document
          </button>
        </form>
      </section>

      {docs.length === 0 ? (
        <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sand-500">
          No documents recorded for {lodgeName} yet.
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((d) => {
            const st = status(d.expiry_date);
            const { cat, text } = splitNotes(d.notes);
            return (
              <form
                key={d.id}
                action={updateDoc}
                className="rounded-xl border border-sand-200 bg-white p-4"
              >
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="lodge" value={lodge} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <select name="category" defaultValue={cat} className={inputCls}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input name="title" defaultValue={d.title} className={inputCls + " lg:col-span-2"} />
                  <input name="issue_date" type="date" defaultValue={forInput(d.issue_date)} className={inputCls} />
                  <input name="expiry_date" type="date" defaultValue={forInput(d.expiry_date)} className={inputCls} />
                  <input name="remark" defaultValue={text} placeholder="Remark" className={inputCls} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs ${st.cls}`}>{st.t}</span>
                  <div className="ml-auto flex gap-2">
                    <button
                      formAction={updateDoc}
                      className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50"
                    >
                      Save
                    </button>
                    <button
                      formAction={deleteDoc}
                      className="rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error-bg"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}
