import { requireUser, isAdmin } from "@/lib/auth";
import { formatValue } from "@/lib/format";
import {
  fetchMetrics,
  monthLabel,
  aggregateByLodge,
  perRoom,
  shortCode,
  type Metrics,
} from "@/lib/dashboard";
import { resolveRange, inRange, DEFAULT_RANGE } from "@/lib/ranges";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { BarCompare, LineTrend, DonutShare } from "@/components/charts";
import { RangeSelect } from "@/components/range-select";
import { SectionHeader } from "@/components/ui";

const toYM = (iso: string) => iso.slice(0, 7); // YYYY-MM-01 -> YYYY-MM

// Money and counts are formatted through the same helper the report uses, so a
// count can never pick up a rupee sign.
const money = (n: number) => formatValue("money", n);
const count = (n: number) => formatValue("count", n);

function thisMonthYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "Central operations feed" style eyebrow shown above the page title.
function Eyebrow({ text, range }: { text: string; range: string }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-olive-200 bg-olive-50 px-2.5 py-0.5 text-olive-700">
        <span className="h-1.5 w-1.5 rounded-full bg-olive-600" aria-hidden="true" />
        {text}
      </span>
      <span className="font-medium normal-case tracking-normal text-sand-500">{range}</span>
    </>
  );
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
        <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center text-sm text-sand-500">
          No monthly reports yet. Add data under <b className="text-olive-800">Reporting &gt; Enter
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
      : `${monthLabel(range.start + "-01")} - ${monthLabel(range.end + "-01")}`;

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
    <div className="rounded-xl border border-sand-200 bg-white p-3 shadow-card">
      <RangeSelect preset={range.key} from={sp.from} to={sp.to} />
    </div>
  );

  if (admin) {
    const totExtras = agg.reduce((t, m) => t + m.extras, 0);
    const totRoomNights = agg.reduce((t, m) => t + m.roomNights, 0);
    const totPax = agg.reduce((t, m) => t + m.pax, 0);
    const totCost = agg.reduce((t, m) => t + m.totalCost, 0);

    return (
      <div className="space-y-8 lg:space-y-10">
        <div>
          <PageHeader
            eyebrow={<Eyebrow text="Central operations feed" range={rangeLabel} />}
            title="Management Dashboard"
            description="Compare lodges and track performance over time."
            action={rangeControl}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon="bed"
              label={`Total room nights (${rangeLabel})`}
              value={count(totRoomNights)}
            />
            <KpiCard icon="users" label="Total pax" value={count(totPax)} />
            <KpiCard icon="receipt" label="Extra sales" value={money(totExtras)} />
            <KpiCard icon="briefcase" label="F&B + Misc + HK" value={money(totCost)} />
          </div>
        </div>

        <section>
          <SectionHeader
            title="Portfolio performance"
            description={`Revenue and cost comparison across lodges for ${rangeLabel}.`}
          />
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <BarCompare
                title={`Extra sales by lodge - ${rangeLabel}`}
                data={agg.map((m) => ({ name: shortCode(m.lodgeName), value: m.extras }))}
              />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <DonutShare
                title="Revenue share by lodge"
                subtitle={`Extra sales - ${rangeLabel}`}
                data={agg
                  .filter((m) => m.extras > 0)
                  .map((m) => ({ name: shortCode(m.lodgeName), value: m.extras }))}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <BarCompare
              title={`F&B cost per guest - ${rangeLabel}`}
              data={agg.map((m) => ({
                name: shortCode(m.lodgeName),
                value: Math.round(m.fnbPerPax),
              }))}
            />
            <BarCompare
              title={`Extra sales per room - ${rangeLabel}`}
              data={agg.map((m) => ({
                name: shortCode(m.lodgeName),
                value: perRoom(m).extrasPerRoom,
              }))}
            />
            <div className="md:col-span-2 xl:col-span-1">
              <BarCompare
                title={`Total expenses per room - ${rangeLabel}`}
                data={agg.map((m) => ({
                  name: shortCode(m.lodgeName),
                  value: perRoom(m).totalExpPerRoom,
                }))}
              />
            </div>
          </div>
        </section>

        <section>
          <SectionHeader title="Trends" description="Month by month, per lodge." />
          <div className="grid gap-4 lg:grid-cols-2">
            <LineTrend
              title="Extra sales trend"
              data={buildTrend((m) => m.extras)}
              series={lodges}
            />
            <LineTrend
              title="Total room nights trend"
              data={buildTrend((m) => m.roomNights)}
              series={lodges}
            />
          </div>
        </section>

        {/* Sales and expenses are two different questions, so they get two
            tables rather than one very wide one. */}
        <section>
          <SectionHeader
            title="Lodge comparison - Sales"
            description={`What each lodge earned over ${rangeLabel}.`}
          />
          <DataTable
            columns={[
              { key: "lodge", label: "Lodge" },
              { key: "rn", label: "Total room nights", className: "text-right tabular" },
              { key: "pax", label: "Pax", className: "text-right tabular" },
              { key: "extras", label: "Extra sales", className: "text-right tabular" },
              { key: "extrasPR", label: "Sales per room", className: "text-right tabular" },
            ]}
            rows={agg.map((m) => ({
              lodge: shortCode(m.lodgeName),
              rn: count(m.roomNights),
              pax: count(m.pax),
              extras: money(m.extras),
              extrasPR: money(perRoom(m).extrasPerRoom),
            }))}
            empty={`No data for ${rangeLabel}.`}
          />
        </section>

        <section>
          <SectionHeader
            title="Lodge comparison - Expenses"
            description={`What each lodge spent over ${rangeLabel}.`}
          />
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
            rows={agg.map((m) => {
              const pr = perRoom(m);
              return {
                lodge: shortCode(m.lodgeName),
                fnb: money(m.fnb),
                misc: money(m.misc),
                hk: money(m.hk),
                cost: money(pr.totalExpenses),
                costPR: money(pr.totalExpPerRoom),
                perpax: m.fnbPerPax ? money(Math.round(m.fnbPerPax)) : "-",
              };
            })}
            empty={`No data for ${rangeLabel}.`}
          />
        </section>
      </div>
    );
  }

  // ---- manager view: their own lodge over the range ----
  const myName = metrics[0]?.lodgeName ?? "Your lodge";
  const mine = agg.find((m) => m.lodgeName === myName) ?? null;
  return (
    <div className="space-y-8 lg:space-y-10">
      <div>
        <PageHeader
          eyebrow={<Eyebrow text="Lodge operations feed" range={rangeLabel} />}
          title={`${myName} - dashboard`}
          description="Your lodge's performance over time."
          action={rangeControl}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon="bed"
            label={`Total room nights (${rangeLabel})`}
            value={count(mine?.roomNights ?? 0)}
          />
          <KpiCard icon="users" label="Pax" value={count(mine?.pax ?? 0)} />
          <KpiCard icon="receipt" label="Extra sales" value={money(mine?.extras ?? 0)} />
          <KpiCard
            icon="briefcase"
            label="F&B per guest"
            value={mine?.fnbPerPax ? money(Math.round(mine.fnbPerPax)) : "-"}
          />
        </div>
      </div>

      <section>
        <SectionHeader title="Trends" description="Month by month for your lodge." />
        <div className="grid gap-4 lg:grid-cols-2">
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
      </section>

      <section>
        <SectionHeader title={`Monthly figures - ${rangeLabel}`} />
        <DataTable
          columns={[
            { key: "month", label: "Month" },
            { key: "rn", label: "Total room nights", className: "text-right tabular" },
            { key: "pax", label: "Pax", className: "text-right tabular" },
            { key: "extras", label: "Extras", className: "text-right tabular" },
            { key: "fnb", label: "F&B", className: "text-right tabular" },
            { key: "cost", label: "Total cost", className: "text-right tabular" },
            { key: "safaris", label: "Safaris", className: "text-right tabular" },
          ]}
          rows={[...inWindow]
            .sort((a, b) => b.month.localeCompare(a.month))
            .map((m) => ({
              month: monthLabel(m.month),
              rn: count(m.roomNights),
              pax: count(m.pax),
              extras: money(m.extras),
              fnb: money(m.fnb),
              cost: money(m.totalCost),
              safaris: count(m.safaris),
            }))}
          empty={`No data for ${rangeLabel}.`}
        />
      </section>
    </div>
  );
}
