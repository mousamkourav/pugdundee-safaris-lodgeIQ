import { redirect } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/auth";
import { inr } from "@/lib/format";
import { fetchMetrics, monthLabel, perRoom } from "@/lib/dashboard";
import { activeGroups } from "@/lib/columns";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { BarCompare } from "@/components/charts";
import { MonthSelect } from "@/components/month-select";
import { ColumnToggle } from "@/components/column-toggle";

const toYM = (iso: string) => iso.slice(0, 7);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; cols?: string }>;
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

  const groups = activeGroups(sp.cols);

  type Col = { key: string; label: string; className?: string };
  const cols: Col[] = [{ key: "lodge", label: "Lodge" }];
  if (groups.has("core")) {
    cols.push(
      { key: "rn", label: "Room nights", className: "tabular" },
      { key: "pax", label: "Pax", className: "tabular" }
    );
  }
  if (groups.has("sales")) {
    cols.push({
      key: "extras",
      label: "Extra sales",
      className: "text-right tabular",
    });
  }
  if (groups.has("expenses")) {
    cols.push(
      { key: "fnb", label: "F&B", className: "text-right tabular" },
      { key: "misc", label: "Misc", className: "text-right tabular" },
      { key: "hk", label: "HK", className: "text-right tabular" },
      { key: "cost", label: "Total expenses", className: "text-right tabular" }
    );
  }
  if (groups.has("perroom")) {
    cols.push(
      { key: "extrasPR", label: "Sales/room", className: "text-right tabular" },
      { key: "costPR", label: "Exp/room", className: "text-right tabular" },
      { key: "fnbPR", label: "F&B/room", className: "text-right tabular" }
    );
  }
  if (groups.has("ops")) {
    cols.push(
      { key: "perpax", label: "F&B/guest", className: "text-right tabular" },
      { key: "energy", label: "Energy", className: "text-right tabular" },
      { key: "safaris", label: "Safaris", className: "tabular" },
      { key: "rating", label: "Rating", className: "tabular" }
    );
  }

  const tableRows = rows.map((m) => {
    const pr = perRoom(m);
    return {
      lodge: m.lodgeName,
      rn: m.roomNights,
      pax: m.pax,
      extras: inr(m.extras),
      fnb: inr(m.fnb),
      misc: inr(m.misc),
      hk: inr(m.hk),
      cost: inr(pr.totalExpenses),
      extrasPR: inr(pr.extrasPerRoom),
      costPR: inr(pr.totalExpPerRoom),
      fnbPR: inr(pr.fnbPerRoom),
      perpax: m.fnbPerPax ? inr(Math.round(m.fnbPerPax)) : "—",
      energy: inr(m.energyCost),
      safaris: m.safaris,
      rating: m.rating ?? "—",
    };
  });

  return (
    <div>
      <PageHeader
        title="Compare lodges"
        description={`All lodges side by side — ${labels[selected]}.`}
        action={
          <div className="flex items-center gap-2">
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

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <BarCompare
          title="Extra sales by lodge"
          data={rows.map((m) => ({ name: m.lodgeName, value: m.extras }))}
        />
        <BarCompare
          title="Total expenses by lodge"
          data={rows.map((m) => ({
            name: m.lodgeName,
            value: perRoom(m).totalExpenses,
          }))}
        />
        <BarCompare
          title="Extra sales per room"
          data={rows.map((m) => ({
            name: m.lodgeName,
            value: perRoom(m).extrasPerRoom,
          }))}
        />
        <BarCompare
          title="Expenses per room"
          data={rows.map((m) => ({
            name: m.lodgeName,
            value: perRoom(m).totalExpPerRoom,
          }))}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg">Lodge comparison — {labels[selected]}</h2>
        <ColumnToggle />
      </div>
      <DataTable columns={cols} rows={tableRows} empty="No data for this month." />
    </div>
  );
}
