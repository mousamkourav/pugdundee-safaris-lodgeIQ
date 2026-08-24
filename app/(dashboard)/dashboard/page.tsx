import { requireUser, isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import {
  fetchMetrics,
  monthLabel,
  aggregateByLodge,
  type Metrics,
} from "@/lib/dashboard";
import { resolveRange, inRange, DEFAULT_RANGE } from "@/lib/ranges";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { BarCompare, LineTrend, DonutShare } from "@/components/charts";
import { RangeSelect } from "@/components/range-select";

const toYM = (iso: string) => iso.slice(0, 7); // YYYY-MM-01 -> YYYY-MM

function thisMonthYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
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

  const range = resolveRange(
    sp.range ?? DEFAULT_RANGE,
    thisMonthYM(),
    sp.from,
    sp.to
  );
  const rangeLabel =
    range.start === range.end
      ? monthLabel(range.start + "-01")
      : `${monthLabel(range.start + "-01")} – ${monthLabel(range.end + "-01")}`;

  // rows within the selected range
  const inWindow = metrics.filter((m) => inRange(toYM(m.month), range));

  // months present in range, ascending, for trend charts
  const monthsAsc = Array.from(
    new Set(inWindow.map((m) => toYM(m.month)))
  ).sort();
  const lodges = Array.from(new Set(metrics.map((m) => m.lodgeName))).sort();

  // one aggregated row per lodge across the range
  const agg = aggregateByLodge(inWindow);

  const buildTrend = (pick: (m: Metrics) => number) =>
    monthsAsc.map((ym) => {
      const row: Record<string, string | number> = {
        label: monthLabel(ym + "-01"),
      };
      for (const ln of lodges) {
        const found = inWindow.find(
          (m) => toYM(m.month) === ym && m.lodgeName === ln
        );
        if (found) row[ln] = pick(found);
      }
      return row;
    });

  const rangeControl = (
    <RangeSelect preset={range.key} from={sp.from} to={sp.to} />
  );

  if (admin) {
    const totExtras = agg.reduce((t, m) => t + m.extras, 0);
    const totRoomNights = agg.reduce((t, m) => t + m.roomNights, 0);
    const totPax = agg.reduce((t, m) => t + m.pax, 0);
    const totCost = agg.reduce((t, m) => t + m.totalCost, 0);

    return (
      <div>
        <PageHeader
          title="Management Dashboard"
          description="Compare lodges and track performance over time."
          action={rangeControl}
        />

        <div className="mb-6">
          <DonutShare
            title="Revenue share by lodge"
            subtitle={`Extra sales · ${rangeLabel}`}
            data={agg
              .filter((m) => m.extras > 0)
              .map((m) => ({ name: m.lodgeName, value: m.extras }))}
            formatValue={(n) => inr(n)}
          />
        </div>

        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label={`Room nights (${rangeLabel})`} value={totRoomNights} />
          <KpiCard label="Total pax" value={totPax} />
          <KpiCard label="Extra sales" value={inr(totExtras)} />
          <KpiCard label="F&B + Misc + HK" value={inr(totCost)} />
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <BarCompare
            title={`Extra sales by lodge — ${rangeLabel}`}
            data={agg.map((m) => ({ name: m.lodgeName, value: m.extras }))}
          />
          <BarCompare
            title={`F&B cost per guest — ${rangeLabel}`}
            data={agg.map((m) => ({
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

        <h2 className="mb-3 text-lg">Lodge comparison — {rangeLabel}</h2>
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
          rows={agg.map((m) => ({
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
          empty={`No data for ${rangeLabel}.`}
        />
      </div>
    );
  }

  // ---- manager view: their own lodge over the range ----
  const myName = metrics[0]?.lodgeName ?? "Your lodge";
  const mine = agg.find((m) => m.lodgeName === myName) ?? null;
  return (
    <div>
      <PageHeader
        title={`${myName} — dashboard`}
        description="Your lodge's performance over time."
        action={rangeControl}
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={`Room nights (${rangeLabel})`} value={mine?.roomNights ?? 0} />
        <KpiCard label="Pax" value={mine?.pax ?? 0} />
        <KpiCard label="Extra sales" value={inr(mine?.extras ?? 0)} />
        <KpiCard
          label="F&B per guest"
          value={mine?.fnbPerPax ? inr(Math.round(mine.fnbPerPax)) : "—"}
        />
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

      <h2 className="mb-3 text-lg">Monthly figures — {rangeLabel}</h2>
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
        rows={[...inWindow]
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
        empty={`No data for ${rangeLabel}.`}
      />
    </div>
  );
}
