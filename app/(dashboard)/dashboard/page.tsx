import { requireUser, isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import { fetchMetrics, monthLabel, type Metrics } from "@/lib/dashboard";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { BarCompare, LineTrend } from "@/components/charts";
import { MonthSelect } from "@/components/month-select";

const toYM = (iso: string) => iso.slice(0, 7); // YYYY-MM-01 -> YYYY-MM

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  const admin = isAdmin(profile?.role);
  const metrics = await fetchMetrics();

  if (metrics.length === 0) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Lodge performance overview." />
        <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sand-500">
          No monthly reports yet. Add data under <b>Monthly reporting → Enter
          monthly report</b>, and it will appear here.
        </div>
      </div>
    );
  }

  // month options (desc), with labels
  const monthsSet = Array.from(new Set(metrics.map((m) => toYM(m.month)))).sort(
    (a, b) => b.localeCompare(a)
  );
  const labels: Record<string, string> = {};
  for (const m of monthsSet) labels[m] = monthLabel(m + "-01");
  const selected = sp.month && monthsSet.includes(sp.month) ? sp.month : monthsSet[0];

  const monthMetrics = metrics.filter((m) => toYM(m.month) === selected);

  // ordered months asc for trends
  const monthsAsc = [...monthsSet].sort();
  const lodges = Array.from(new Set(metrics.map((m) => m.lodgeName))).sort();

  // ---- trend datasets (one line per lodge) ----
  const buildTrend = (pick: (m: Metrics) => number) =>
    monthsAsc.map((ym) => {
      const row: Record<string, string | number> = { label: monthLabel(ym + "-01") };
      for (const ln of lodges) {
        const found = metrics.find(
          (m) => toYM(m.month) === ym && m.lodgeName === ln
        );
        if (found) row[ln] = pick(found);
      }
      return row;
    });

  if (admin) {
    // cross-lodge view
    const totExtras = monthMetrics.reduce((t, m) => t + m.extras, 0);
    const totRoomNights = monthMetrics.reduce((t, m) => t + m.roomNights, 0);
    const totPax = monthMetrics.reduce((t, m) => t + m.pax, 0);
    const totCost = monthMetrics.reduce((t, m) => t + m.totalCost, 0);

    return (
      <div>
        <PageHeader
          title="Management Dashboard"
          description="Compare lodges and track performance month over month."
          action={
            <MonthSelect months={monthsSet} selected={selected} labels={labels} />
          }
        />

        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label={`Room nights (${labels[selected]})`} value={totRoomNights} />
          <KpiCard label="Total pax" value={totPax} />
          <KpiCard label="Extra sales" value={inr(totExtras)} />
          <KpiCard label="F&B + Misc + HK" value={inr(totCost)} />
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <BarCompare
            title={`Extra sales by lodge — ${labels[selected]}`}
            data={monthMetrics.map((m) => ({ name: m.lodgeName, value: m.extras }))}
          />
          <BarCompare
            title={`F&B cost per guest — ${labels[selected]}`}
            data={monthMetrics.map((m) => ({
              name: m.lodgeName,
              value: Math.round(m.fnbPerPax),
            }))}
          />
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <LineTrend
            title="Extra sales trend"
            data={buildTrend((m) => m.extras)}
            series={lodges}
          />
          <LineTrend
            title="Room nights trend"
            data={buildTrend((m) => m.roomNights)}
            series={lodges}
          />
        </div>

        <h2 className="mb-3 text-lg">Lodge comparison — {labels[selected]}</h2>
        <DataTable
          columns={[
            { key: "lodge", label: "Lodge" },
            { key: "rn", label: "Room nights", className: "tabular" },
            { key: "pax", label: "Pax", className: "tabular" },
            { key: "extras", label: "Extras", className: "text-right tabular" },
            { key: "fnb", label: "F&B", className: "text-right tabular" },
            { key: "perpax", label: "F&B/guest", className: "text-right tabular" },
            { key: "cost", label: "Total cost", className: "text-right tabular" },
            { key: "energy", label: "Energy", className: "text-right tabular" },
            { key: "safaris", label: "Safaris", className: "tabular" },
            { key: "rating", label: "Rating", className: "tabular" },
          ]}
          rows={monthMetrics
            .sort((a, b) => b.extras - a.extras)
            .map((m) => ({
              lodge: m.lodgeName,
              rn: m.roomNights,
              pax: m.pax,
              extras: inr(m.extras),
              fnb: inr(m.fnb),
              perpax: m.fnbPerPax ? inr(Math.round(m.fnbPerPax)) : "—",
              cost: inr(m.totalCost),
              energy: inr(m.energyCost),
              safaris: m.safaris,
              rating: m.rating ?? "—",
            }))}
          empty="No data for this month."
        />
      </div>
    );
  }

  // ---- manager view: their own lodge over time ----
  const myName = metrics[0]?.lodgeName ?? "Your lodge";
  const latest = monthMetrics[0] ?? metrics[metrics.length - 1];
  return (
    <div>
      <PageHeader
        title={`${myName} — dashboard`}
        description="Your lodge's performance over time."
        action={
          <MonthSelect months={monthsSet} selected={selected} labels={labels} />
        }
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={`Room nights (${labels[selected]})`} value={latest?.roomNights ?? 0} />
        <KpiCard label="Pax" value={latest?.pax ?? 0} />
        <KpiCard label="Extra sales" value={inr(latest?.extras ?? 0)} />
        <KpiCard label="F&B per guest" value={latest?.fnbPerPax ? inr(Math.round(latest.fnbPerPax)) : "—"} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <LineTrend
          title="Extra sales trend"
          data={buildTrend((m) => m.extras)}
          series={[myName]}
        />
        <LineTrend
          title="Costs trend (F&B+Misc+HK)"
          data={buildTrend((m) => m.totalCost)}
          series={[myName]}
        />
      </div>

      <h2 className="mb-3 text-lg">Monthly figures</h2>
      <DataTable
        columns={[
          { key: "month", label: "Month" },
          { key: "rn", label: "Room nights", className: "tabular" },
          { key: "pax", label: "Pax", className: "tabular" },
          { key: "extras", label: "Extras", className: "text-right tabular" },
          { key: "fnb", label: "F&B", className: "text-right tabular" },
          { key: "cost", label: "Total cost", className: "text-right tabular" },
          { key: "safaris", label: "Safaris", className: "tabular" },
        ]}
        rows={[...metrics]
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((m) => ({
            month: monthLabel(m.month),
            rn: m.roomNights,
            pax: m.pax,
            extras: inr(m.extras),
            fnb: inr(m.fnb),
            cost: inr(m.totalCost),
            safaris: m.safaris,
          }))}
        empty="No data yet."
      />
    </div>
  );
}
