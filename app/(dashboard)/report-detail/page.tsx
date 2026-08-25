import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { SECTIONS, getPath, type Field } from "@/lib/monthly";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { PrintButton } from "@/components/print-button";

/* eslint-disable @typescript-eslint/no-explicit-any */

function fmt(field: Field, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "—";
  if (field.type === "rating") return String(raw);
  if (field.type === "number") {
    const num = Number(raw);
    if (!Number.isFinite(num)) return String(raw);
    return inr(num);
  }
  if (field.type === "bool") return raw ? "Yes" : "No";
  return String(raw);
}

// group a section's fields by their optional subsection tag (Accommodation, etc.)
function grouped(fields: Field[]) {
  const out: { name: string | null; items: Field[] }[] = [];
  let cur: { name: string | null; items: Field[] } | null = null;
  for (const f of fields) {
    const name = f.group ?? null;
    if (!cur || cur.name !== name) {
      cur = { name, items: [] };
      out.push(cur);
    }
    cur.items.push(f);
  }
  return out;
}

export default async function ReportDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Detailed report" />;

  const { start, label } = monthRange(month);
  const s = await createClient();
  const { data: row } = await s
    .from("monthly_submissions")
    .select("data, status")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .maybeSingle();

  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";
  const data = ((row as any)?.data ?? {}) as Record<string, unknown>;
  const status = (row as any)?.status ?? null;
  const hasData = !!row;

  return (
    <div>
      <style>{`@media print { aside, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <PageHeader
        title="Detailed report"
        description={`${lodgeName} · ${label}${status ? " · " + status : ""}`}
        action={
          <div className="no-print flex flex-wrap gap-2">
            <a
              href={`/api/report?lodge=${lodge}&month=${month}`}
              className="rounded-lg border border-sand-200 px-4 py-2 text-sm text-sand-700 hover:bg-sand-50"
            >
              Export Excel
            </a>
            <PrintButton />
          </div>
        }
      />

      <div className="no-print mb-6">
        <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />
      </div>

      {!hasData && (
        <div className="mb-6 rounded-xl border border-sand-200 bg-white p-6 text-center text-sand-500">
          No monthly report submitted for {lodgeName} in {label} yet.
        </div>
      )}

      <div className="space-y-6">
        {SECTIONS.map((sec) => {
          const fieldGroups = sec.fields ? grouped(sec.fields) : [];
          return (
            <section
              key={sec.key}
              className="break-inside-avoid rounded-xl border border-sand-200 bg-white p-5"
            >
              <h3 className="mb-3 text-base font-medium text-sand-800">
                {sec.title}
              </h3>

              {fieldGroups.map((grp, gi) => (
                <div key={gi} className="mb-4 last:mb-0">
                  {grp.name && (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-400">
                      {grp.name}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                    {grp.items.map((f) => (
                      <div
                        key={f.path}
                        className="flex justify-between border-b border-sand-100 py-1.5 text-sm"
                      >
                        <span className="text-sand-500">{f.label}</span>
                        <span className="tabular text-sand-800">
                          {fmt(f, getPath(data, f.path))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {sec.arrays?.map((arr) => {
                const rows = (data[arr.path] as any[]) ?? [];
                return (
                  <div key={arr.path} className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-400">
                      {arr.label}
                    </p>
                    {rows.length === 0 ? (
                      <p className="text-sm text-sand-400">None recorded.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-sand-200 text-left text-xs text-sand-500">
                              {arr.columns.map((c) => (
                                <th key={c.key} className="py-1.5 pr-4 font-medium">
                                  {c.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, ri) => (
                              <tr key={ri} className="border-b border-sand-100">
                                {arr.columns.map((c) => (
                                  <td key={c.key} className="py-1.5 pr-4 text-sand-800">
                                    {r?.[c.key] === undefined ||
                                    r?.[c.key] === null ||
                                    r?.[c.key] === ""
                                      ? "—"
                                      : String(r[c.key])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
