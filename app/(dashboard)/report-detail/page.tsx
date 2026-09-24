import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, formatValue } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  getPath,
  groupFields,
  sectionsForLodge,
  splitTitle,
  type ArrayCol,
  type Field,
} from "@/lib/monthly";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { PrintButton } from "@/components/print-button";
import { SectionNav } from "@/components/section-nav";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Whether a value is money or a count is decided by the field's `unit` in
// lib/monthly.ts -- never here. See formatValue() in lib/format.ts.
function fmt(field: Field | ArrayCol, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "-";
  if (field.type === "bool") return raw ? "Yes" : "No";
  if (field.type === "text" || field.type === "date") return String(raw);
  return formatValue(field.unit, raw);
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

  // Only the sections that apply to this lodge, so the Denwa-only sections stay
  // hidden on every other lodge's report.
  const sections = sectionsForLodge(lodgeName);

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

      <SectionNav
        sections={sections.map((sec) => ({ key: sec.key, title: sec.title }))}
      />

      <div className="space-y-8">
        {sections.map((sec) => {
          const fieldGroups = sec.fields ? groupFields(sec.fields) : [];
          const { number, name } = splitTitle(sec.title);
          return (
            <section
              key={sec.key}
              id={`section-${sec.key}`}
              className="break-inside-avoid scroll-mt-20 overflow-hidden rounded-xl border border-sand-200 bg-white"
            >
              <h3 className="flex items-center gap-3 border-l-4 border-olive-600 bg-sand-100 px-4 py-3 text-base font-medium text-sand-800">
                {number && (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-olive-600 text-xs font-semibold text-white">
                    {number}
                  </span>
                )}
                <span className="min-w-0">{name}</span>
              </h3>

              <div className="p-4 sm:p-5">
                {fieldGroups.map((grp, gi) => (
                  <div
                    key={gi}
                    className={
                      "mb-5 last:mb-0" +
                      (grp.name && gi > 0 ? " border-t border-sand-200 pt-4" : "")
                    }
                  >
                    {grp.name && (
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">
                        {grp.name}
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {grp.fields.map((f) => (
                        <div
                          key={f.path}
                          className="border-b border-sand-100 py-1.5 text-sm sm:flex sm:items-baseline sm:justify-between sm:gap-3"
                        >
                          <span className="block text-sand-500">{f.label}</span>
                          <span className="tabular block font-medium text-sand-800 sm:text-right">
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
                    <div
                      key={arr.path}
                      className="mt-5 border-t border-sand-200 pt-4"
                    >
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">
                        {arr.label}
                      </p>
                      {rows.length === 0 ? (
                        <p className="text-sm text-sand-400">None recorded.</p>
                      ) : (
                        <>
                          {/* real table from md up */}
                          <div className="hidden overflow-x-auto md:block">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-sand-200 text-left text-xs text-sand-500">
                                  {arr.columns.map((c) => (
                                    <th
                                      key={c.key}
                                      className="py-1.5 pr-4 font-medium"
                                    >
                                      {c.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r, ri) => (
                                  <tr
                                    key={ri}
                                    className="border-b border-sand-100"
                                  >
                                    {arr.columns.map((c) => (
                                      <td
                                        key={c.key}
                                        className="tabular py-1.5 pr-4 text-sand-800"
                                      >
                                        {fmt(c, r?.[c.key])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {/* stacked label/value cards below md */}
                          <div className="space-y-2 md:hidden">
                            {rows.map((r, ri) => (
                              <div
                                key={ri}
                                className="rounded-lg border border-sand-200 p-3"
                              >
                                {arr.columns.map((c) => (
                                  <div
                                    key={c.key}
                                    className="flex items-baseline justify-between gap-3 border-b border-sand-100 py-1 text-sm last:border-b-0"
                                  >
                                    <span className="text-sand-500">
                                      {c.label}
                                    </span>
                                    <span className="tabular text-right text-sand-800">
                                      {fmt(c, r?.[c.key])}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
