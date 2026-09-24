import { redirect } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/auth";
import { formatValue } from "@/lib/format";
import { fetchMetrics, monthLabel, perRoom, shortCode } from "@/lib/dashboard";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { BarCompare } from "@/components/charts";
import { MonthSelect } from "@/components/month-select";

const toYM = (iso: string) => iso.slice(0, 7);

const money = (n: number) => formatValue("money", n);
const count = (n: number) => formatValue("count", n);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { profile } = await requireUser();
  if (!isAdmin(profile?.role)) redirect("/dashboard");
  const sp = await searchParams;
  const metrics = await fetchMetrics();

  if (metrics.length === 0) {
    return (
      <div>
        <PageHeader title="Compare lodges" description="Cross-lodge comparison." />
        <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sand-500">
          No monthly reports yet.
        </div>
      </div>
    );
  }

  const monthsSet = Array.from(new Set(metrics.map((m) => toYM(m.month)))).sort(
    (a, b) => b.localeCompare(a)
  );
  const labels: Record<string, string> = {};
  for (const m of monthsSet) labels[m] = monthLabel(m + "-01");
  const selected =
    sp.month && monthsSet.includes(sp.month) ? sp.month : monthsSet[0];
  const rows = metrics
    .filter((m) => toYM(m.month) === selected)
    .sort((a, b) => b.extras - a.extras);

  return (
    <div>
      <PageHeader
        title="Compare lodges"
        description={`All lodges side by side — ${labels[selected]}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <MonthSelect months={monthsSet} selected={selected} labels={labels} />
            <a
              href={`/api/compare?month=${selected}`}
              className="rounded-lg bg-olive-600 px-3 py-2 text-sm font-medium text-white hover:bg-olive-700"
            >
              Export Excel
            </a>
          </div>
        }
      />

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <BarCompare
          title="Extra sales by lodge"
          data={rows.map((m) => ({ name: shortCode(m.lodgeName), value: m.extras }))}
        />
        <BarCompare
          title="Total expenses by lodge"
          data={rows.map((m) => ({
            name: shortCode(m.lodgeName),
            value: perRoom(m).totalExpenses,
          }))}
        />
        <BarCompare
          title="Extra sales per room"
          data={rows.map((m) => ({
            name: shortCode(m.lodgeName),
            value: perRoom(m).extrasPerRoom,
          }))}
        />
        <BarCompare
          title="Expenses per room"
          data={rows.map((m) => ({
            name: shortCode(m.lodgeName),
            value: perRoom(m).totalExpPerRoom,
          }))}
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-1 text-lg">Lodge comparison - Sales</h2>
        <p className="mb-3 text-sm text-sand-600">
          What each lodge earned in {labels[selected]}.
        </p>
        <DataTable
          columns={[
            { key: "lodge", label: "Lodge" },
            { key: "rn", label: "Total room nights", className: "text-right tabular" },
            { key: "pax", label: "Pax", className: "text-right tabular" },
            { key: "extras", label: "Extra sales", className: "text-right tabular" },
            { key: "extrasPR", label: "Sales per room", className: "text-right tabular" },
          ]}
          rows={rows.map((m) => ({
            lodge: m.lodgeName,
            rn: count(m.roomNights),
            pax: count(m.pax),
            extras: money(m.extras),
            extrasPR: money(perRoom(m).extrasPerRoom),
          }))}
          empty="No data for this month."
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg">Lodge comparison - Expenses</h2>
        <p className="mb-3 text-sm text-sand-600">
          What each lodge spent in {labels[selected]}.
        </p>
        <DataTable
          columns={[
            { key: "lodge", label: "Lodge" },
            { key: "fnb", label: "F&B", className: "text-right tabular" },
            { key: "misc", label: "Misc", className: "text-right tabular" },
            { key: "hk", label: "Housekeeping", className: "text-right tabular" },
            { key: "cost", label: "Total expenses", className: "text-right tabular" },
            { key: "costPR", label: "Expenses per room", className: "text-right tabular" },
            { key: "perpax", label: "F&B per guest", className: "text-right tabular" },
          ]}
          rows={rows.map((m) => {
            const pr = perRoom(m);
            return {
              lodge: m.lodgeName,
              fnb: money(m.fnb),
              misc: money(m.misc),
              hk: money(m.hk),
              cost: money(pr.totalExpenses),
              costPR: money(pr.totalExpPerRoom),
              perpax: m.fnbPerPax ? money(Math.round(m.fnbPerPax)) : "-",
            };
          })}
          empty="No data for this month."
        />
      </section>
    </div>
  );
}
