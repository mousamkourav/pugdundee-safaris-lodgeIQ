import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { Icon } from "@/components/icons";
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

const CAT_ICON: Record<string, string> = {
  License: "fileText",
  Insurance: "shield",
  AMC: "wrench",
  Fitness: "car",
  Pollution: "leaf",
  Other: "clipboard",
};

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
  if (d === null) return { t: "No date", cls: "border-sand-200 bg-sand-100 text-sand-600", rank: 3 };
  // treat the far-future placeholder as "no deadline"
  if (valid_to === "2099-12-31") return { t: "No expiry", cls: "border-sand-200 bg-sand-100 text-sand-600", rank: 3 };
  if (d < 0) return { t: "Expired", cls: "border-error-border bg-error-bg text-error", rank: 0 };
  if (d <= 30) return { t: `${d}d left`, cls: "border-error-border bg-error-bg text-error", rank: 1 };
  if (d <= 90) return { t: `${d}d left`, cls: "border-warning-border bg-warning-bg text-warning", rank: 2 };
  return { t: "Valid", cls: "border-success-border bg-success-bg text-success", rank: 4 };
}

// Icon tile tint per status rank (presentation only).
const RANK_TILE: Record<number, string> = {
  0: "bg-error-bg text-error",
  1: "bg-error-bg text-error",
  2: "bg-warning-bg text-warning",
  3: "bg-sand-100 text-sand-600",
  4: "bg-success-bg text-success",
};

function forInput(iso: string | null): string {
  if (!iso || iso === "2099-12-31") return "";
  return iso;
}

function ddmmyyyy(iso: string | null): string {
  if (!iso || iso === "2099-12-31") return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}-${m}-${y}` : iso;
}

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35";
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-sand-500";

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; cat?: string }>;
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
  // Display-only tallies for the summary cards, from the same status() rules.
  const valid = docs.filter((d) => status(d.expiry_date).rank === 4).length;
  const renewSoon = docs.filter((d) => status(d.expiry_date).rank === 2).length;

  const sorted = [...docs].sort(
    (a, b) => status(a.expiry_date).rank - status(b.expiry_date).rank
  );

  // Category chips filter the list in the page only (?cat=); nothing else uses it.
  const catCounts = new Map<string, number>();
  for (const d of docs) {
    const c = splitNotes(d.notes).cat;
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const activeCat = sp.cat && catCounts.has(sp.cat) ? sp.cat : null;
  const visible = activeCat
    ? sorted.filter((d) => splitNotes(d.notes).cat === activeCat)
    : sorted;
  const slug = lodgeSlug(lodgeName);
  const catHref = (c: string | null) =>
    `/compliance?lodge=${encodeURIComponent(slug)}${c ? `&cat=${encodeURIComponent(c)}` : ""}`;

  const cards = [
    {
      n: expired,
      label: "Expired documents",
      pill: "Critical alert",
      tone: "border-error-border bg-error-bg text-error",
      dot: "bg-error",
      num: "text-error",
      icon: "shield",
      foot: expired ? "Renew immediately" : "Nothing expired",
    },
    {
      n: soon,
      label: "Expiring in 30 days",
      pill: "Action required",
      tone: "border-warning-border bg-warning-bg text-warning",
      dot: "bg-warning",
      num: "text-warning",
      icon: "bell",
      foot: soon ? "Renewal window open" : "No urgent renewals",
    },
    {
      n: valid,
      label: "Active & valid",
      pill: "Operational",
      tone: "border-success-border bg-success-bg text-success",
      dot: "bg-success",
      num: "text-olive-800",
      icon: "shield",
      foot: "More than 90 days left",
    },
    {
      n: renewSoon,
      label: "Due in 31-90 days",
      pill: "Upcoming",
      tone: "border-sand-200 bg-sand-100 text-sand-600",
      dot: "bg-sand-400",
      num: "text-olive-800",
      icon: "fileText",
      foot: "Plan renewals ahead",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          eyebrow={
            <>
              <span className="rounded-full border border-gold-200 bg-gold-50 px-2.5 py-0.5 text-gold-800">
                Statutory registry
              </span>
              <span className="font-medium normal-case tracking-normal text-sand-500">
                {lodgeName} - {docs.length} documents
              </span>
            </>
          }
          title="Insurances & licences"
          description="Insurances, licences, AMCs and statutory permits for this lodge, with expiry tracking."
          action={
            <div className="[&>div]:mb-0 [&_select]:w-full sm:[&_select]:w-auto">
              <LodgePicker lodges={lodges} lodge={lodge} />
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((c) => (
            <div
              key={c.label}
              className="relative overflow-hidden rounded-xl border border-sand-200 bg-white p-5 shadow-card"
            >
              <span
                className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-sand-50"
                aria-hidden="true"
              />
              <div className="relative flex items-start justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.tone}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
                  {c.pill}
                </span>
                <Icon name={c.icon} className="h-5 w-5 text-sand-500" />
              </div>
              <p className={`relative mt-3 font-display text-4xl font-bold tabular ${c.num}`}>
                {String(c.n).padStart(2, "0")}
              </p>
              <p className="relative mt-1 text-[15px] font-medium text-sand-800">{c.label}</p>
              <p className="relative mt-3 text-xs font-semibold text-sand-500">{c.foot}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        {/* Add new document */}
        <section className="rounded-xl border border-sand-200 bg-white p-5 shadow-card lg:sticky lg:top-24">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-olive-600 text-white">
              <Icon name="fileText" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base leading-6">Add new document</h2>
              <p className="text-xs text-sand-500">Licence, insurance, AMC or permit</p>
            </div>
          </div>
          <form action={addDoc} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <input type="hidden" name="lodge" value={lodge} />
            <label className="block">
              <span className={labelCls}>Category</span>
              <select name="category" className={inputCls} defaultValue="License">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Document name *</span>
              <input name="title" placeholder="Document name" required className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Valid from</span>
              <input name="issue_date" type="date" title="Valid from" className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>Valid to</span>
              <input name="expiry_date" type="date" title="Valid to" className={inputCls} />
            </label>
            <label className="block sm:col-span-2 lg:col-span-1">
              <span className={labelCls}>Remark / policy no.</span>
              <input name="remark" placeholder="Remark / policy no." className={inputCls} />
            </label>
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-olive-700 sm:col-span-2 sm:min-h-10 lg:col-span-1">
              + Add document
            </button>
          </form>
        </section>

        {/* Registry */}
        <section className="min-w-0 overflow-hidden rounded-xl border border-sand-200 bg-white shadow-card">
          {docs.length > 0 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-sand-200 p-3">
              {[{ c: null as string | null, n: docs.length, t: "All" }, ...CATEGORIES.filter((c) => catCounts.has(c)).map((c) => ({ c, n: catCounts.get(c) ?? 0, t: c })), ...Array.from(catCounts.keys()).filter((c) => !CATEGORIES.includes(c)).map((c) => ({ c, n: catCounts.get(c) ?? 0, t: c }))].map((chip) => {
                const on = chip.c === activeCat;
                return (
                  <Link
                    key={chip.t}
                    href={catHref(chip.c)}
                    className={
                      "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition " +
                      (on
                        ? "bg-olive-600 font-semibold text-white"
                        : "bg-sand-100 text-sand-700 hover:bg-sand-200")
                    }
                  >
                    {chip.t}
                    <span className={"text-xs tabular " + (on ? "text-olive-100" : "text-sand-500")}>
                      ({chip.n})
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {docs.length === 0 ? (
            <div className="p-10 text-center text-sm text-sand-500">
              No documents recorded for {lodgeName} yet.
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_120px_120px_110px] gap-4 bg-sand-100 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-sand-600 md:grid">
                <span>Document / permit</span>
                <span>Valid from</span>
                <span>Valid to</span>
                <span className="text-right">Status</span>
              </div>
              <ul className="divide-y divide-sand-100">
                {visible.map((d) => {
                  const st = status(d.expiry_date);
                  const { cat, text } = splitNotes(d.notes);
                  return (
                    <li key={d.id}>
                      <details className="group">
                        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-4 transition hover:bg-sand-50 sm:px-5 md:grid-cols-[minmax(0,1fr)_120px_120px_110px] md:items-center">
                          <div className="flex min-w-0 items-start gap-3">
                            <span
                              className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${RANK_TILE[st.rank] ?? RANK_TILE[3]}`}
                            >
                              <Icon name={CAT_ICON[cat] ?? "clipboard"} className="h-5 w-5" />
                            </span>
                            <div className="min-w-0">
                              <p className="break-words font-medium text-olive-800">{d.title}</p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-sand-500">
                                <span className="rounded bg-sand-100 px-1.5 py-px font-medium text-sand-600">
                                  {cat}
                                </span>
                                {text && <span className="break-words">{text}</span>}
                              </p>
                              <p className="mt-1 text-xs text-sand-500 md:hidden">
                                {ddmmyyyy(d.issue_date)} to {ddmmyyyy(d.expiry_date)}
                              </p>
                            </div>
                          </div>
                          <span className="hidden text-sm text-sand-700 tabular md:block">
                            {ddmmyyyy(d.issue_date)}
                          </span>
                          <span className="hidden text-sm text-sand-700 tabular md:block">
                            {ddmmyyyy(d.expiry_date)}
                          </span>
                          <span className="flex flex-col items-end gap-1 md:text-right">
                            <span
                              className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
                            >
                              {st.t}
                            </span>
                            <span className="text-[11px] font-medium text-olive-600 group-open:hidden">
                              Edit
                            </span>
                            <span className="hidden text-[11px] font-medium text-sand-500 group-open:inline">
                              Close
                            </span>
                          </span>
                        </summary>

                        <form
                          action={updateDoc}
                          className="border-t border-sand-100 bg-sand-50 px-4 py-4 sm:px-5"
                        >
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="lodge" value={lodge} />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
                            <label className="block">
                              <span className={labelCls}>Category</span>
                              <select name="category" defaultValue={cat} className={inputCls}>
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block xl:col-span-2">
                              <span className={labelCls}>Document name</span>
                              <input name="title" defaultValue={d.title} className={inputCls} />
                            </label>
                            <label className="block">
                              <span className={labelCls}>Valid from</span>
                              <input name="issue_date" type="date" defaultValue={forInput(d.issue_date)} className={inputCls} />
                            </label>
                            <label className="block">
                              <span className={labelCls}>Valid to</span>
                              <input name="expiry_date" type="date" defaultValue={forInput(d.expiry_date)} className={inputCls} />
                            </label>
                            <label className="block">
                              <span className={labelCls}>Remark</span>
                              <input name="remark" defaultValue={text} placeholder="Remark" className={inputCls} />
                            </label>
                          </div>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                              formAction={deleteDoc}
                              className="inline-flex min-h-10 items-center rounded-lg border border-error-border bg-white px-3.5 py-2 text-sm font-medium text-error transition hover:bg-error-bg sm:min-h-9"
                            >
                              Delete
                            </button>
                            <button
                              formAction={updateDoc}
                              className="inline-flex min-h-10 items-center rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-olive-700 sm:min-h-9"
                            >
                              Save changes
                            </button>
                          </div>
                        </form>
                      </details>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-sand-200 px-5 py-3 text-xs text-sand-500">
                Showing {visible.length} of {docs.length} documents for {lodgeName}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
