import { redirect } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import { fetchMetrics, monthLabel } from "@/lib/dashboard";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { BarCompare } from "@/components/charts";
import { MonthSelect } from "@/components/month-select";

const toYM = (iso: string) => iso.slice(0, 7);

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
          <MonthSelect months={monthsSet} selected={selected} labels={labels} />
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <BarCompare
          title="Extra sales by lodge"
          data={rows.map((m) => ({ name: m.lodgeName, value: m.extras }))}
        />
        <BarCompare
          title="Total cost by lodge"
          data={rows.map((m) => ({ name: m.lodgeName, value: m.totalCost }))}
        />
      </div>

      <DataTable
        columns={[
          { key: "lodge", label: "Lodge" },
          { key: "rn", label: "Room nights", className: "tabular" },
          { key: "pax", label: "Pax", className: "tabular" },
          { key: "extras", label: "Extras", className: "text-right tabular" },
          { key: "fnb", label: "F&B", className: "text-right tabular" },
          { key: "perpax", label: "F&B/guest", className: "text-right tabular" },
          { key: "misc", label: "Misc", className: "text-right tabular" },
          { key: "hk", label: "HK", className: "text-right tabular" },
          { key: "cost", label: "Total cost", className: "text-right tabular" },
          { key: "safaris", label: "Safaris", className: "tabular" },
        ]}
        rows={rows.map((m) => ({
          lodge: m.lodgeName,
          rn: m.roomNights,
          pax: m.pax,
          extras: inr(m.extras),
          fnb: inr(m.fnb),
          perpax: m.fnbPerPax ? inr(Math.round(m.fnbPerPax)) : "—",
          misc: inr(m.misc),
          hk: inr(m.hk),
          cost: inr(m.totalCost),
          safaris: m.safaris,
        }))}
        empty="No data for this month."
      />
    </div>
  );
}
