import { redirect } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/auth";
import { getAccessibleLodges } from "@/lib/lodges";
import { currentMonth, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getMonthlySummary } from "@/lib/report";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { MonthPicker } from "@/components/month-picker";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { profile } = await requireUser();
  if (!isAdmin(profile?.role)) redirect("/dashboard");
  const sp = await searchParams;
  const month = sp.month || currentMonth();

  const lodges = await getAccessibleLodges();
  const s = await createClient();
  const summaries = await Promise.all(
    lodges.map(async (l) => ({
      lodge: l,
      sm: await getMonthlySummary(s, l.id, month),
    }))
  );

  const label = summaries[0]?.sm.label ?? month;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={`Cross-lodge comparison for ${label}.`}
      />
      <MonthPicker month={month} />

      <DataTable
        columns={[
          { key: "lodge", label: "Lodge" },
          { key: "rn", label: "Room nights", className: "tabular" },
          { key: "pax", label: "Pax", className: "tabular" },
          { key: "extras", label: "Extras", className: "text-right tabular" },
          { key: "fnb", label: "F&B", className: "text-right tabular" },
          { key: "perpax", label: "F&B/guest", className: "text-right tabular" },
          { key: "energy", label: "Energy", className: "text-right tabular" },
          { key: "payroll", label: "Payroll", className: "text-right tabular" },
          { key: "overdue", label: "Overdue", className: "tabular" },
        ]}
        rows={summaries.map(({ lodge, sm }) => ({
          lodge: lodge.name,
          rn: sm.roomNights,
          pax: sm.pax,
          extras: inr(sm.extrasTotal),
          fnb: inr(sm.fnb),
          perpax: sm.fnbPerPax !== null ? inr(sm.fnbPerPax) : "—",
          energy: inr(sm.energyCost),
          payroll: inr(sm.payrollNet),
          overdue:
            sm.overdue > 0 ? (
              <span className="rounded-full bg-error-bg px-2 py-0.5 text-xs text-error">
                {sm.overdue}
              </span>
            ) : (
              0
            ),
        }))}
        empty="No lodges to compare yet."
      />
      <p className="mt-4 text-sm text-sand-500">
        Figures roll up from daily entries for the selected month. Add more months of
        data to compare trends over time.
      </p>
    </div>
  );
}
