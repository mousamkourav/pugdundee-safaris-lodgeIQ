import { requireUser, isAdmin } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getMonthlySummary } from "@/lib/report";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { PrintButton } from "@/components/print-button";
import { generateReport, submitReport, reviewReport } from "./actions";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between border-b border-sand-100 py-2 text-sm">
      <span className="text-sand-600">{label}</span>
      <span className="tabular text-sand-800">{value}</span>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Monthly report" />;

  const { start } = monthRange(month);
  const s = await createClient();
  const summary = await getMonthlySummary(s, lodge, month);
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";
  const { data: rep } = await s
    .from("monthly_reports")
    .select("*")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .maybeSingle();
  const report = rep as Record<string, string> | null;
  const admin = isAdmin(profile?.role);
  const status = report?.status ?? "none";

  return (
    <div>
      <style>{`@media print { aside { display: none !important; } main { padding: 0 !important; } .no-print { display: none !important; } }`}</style>

      <PageHeader
        title="Monthly report"
        description={`${lodgeName} · ${summary.label}`}
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

      {/* Status + workflow */}
      <div className="no-print mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-sand-200 bg-white p-4">
        <span className="text-sm text-sand-600">Status:</span>
        <span
          className={
            "rounded-full px-3 py-1 text-xs capitalize " +
            (status === "reviewed"
              ? "bg-success-bg text-success"
              : status === "submitted"
              ? "bg-info-bg text-info"
              : status === "draft"
              ? "bg-warning-bg text-warning"
              : "bg-sand-100 text-sand-600")
          }
        >
          {status === "none" ? "Not generated" : status}
        </span>
        <div className="ml-auto flex gap-2">
          <form action={generateReport}>
            <input type="hidden" name="lodge_id" value={lodge} />
            <input type="hidden" name="month" value={month} />
            <button className="rounded-lg bg-olive-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-olive-700">
              {status === "none" ? "Generate" : "Refresh"}
            </button>
          </form>
          {report && status === "draft" && (
            <form action={submitReport}>
              <input type="hidden" name="id" value={report.id} />
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <button className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50">
                Submit
              </button>
            </form>
          )}
          {report && status === "submitted" && admin && (
            <form action={reviewReport}>
              <input type="hidden" name="id" value={report.id} />
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <button className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50">
                Mark reviewed
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Compiled report */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h3 className="mb-2 text-base">Occupancy &amp; revenue</h3>
          <Row label="Rooms paid" value={summary.roomsPaid} />
          <Row label="Rooms comp" value={summary.roomsComp} />
          <Row label="Room nights" value={summary.roomNights} />
          <Row label="Total pax" value={summary.pax} />
          <Row label="Extra sales" value={inr(summary.extrasTotal)} />
          <Row label="TripAdvisor" value={summary.tripadvisor ?? "—"} />
          <Row label="Google" value={summary.google ?? "—"} />
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h3 className="mb-2 text-base">Costs</h3>
          <Row label="F&B" value={inr(summary.fnb)} />
          <Row label="Misc" value={inr(summary.misc)} />
          <Row label="Housekeeping" value={inr(summary.hk)} />
          <Row label="Total (F&B+Misc+HK)" value={inr(summary.totalExpenses)} />
          <Row label="F&B per guest" value={summary.fnbPerPax !== null ? inr(summary.fnbPerPax) : "—"} />
          <Row label="F&B per room" value={summary.fnbPerRoom !== null ? inr(summary.fnbPerRoom) : "—"} />
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h3 className="mb-2 text-base">Energy &amp; vehicles</h3>
          <Row label="Energy cost" value={inr(summary.energyCost)} />
          <Row label="Fuel used (L)" value={Math.round(summary.fuelLitres)} />
          <Row label="Vehicle cost" value={inr(summary.vehicleCost)} />
          <Row label="Vehicle km" value={Math.round(summary.vehicleKm)} />
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h3 className="mb-2 text-base">People, stock &amp; compliance</h3>
          <Row label="Payroll (net)" value={inr(summary.payrollNet)} />
          <Row label="Purchases" value={inr(summary.purchasesTotal)} />
          <Row label="Low-stock items" value={summary.lowStock} />
          <Row label="Overdue services" value={summary.overdue} />
        </div>
      </div>
    </div>
  );
}
