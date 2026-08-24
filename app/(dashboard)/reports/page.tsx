import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getSubmissionSummary } from "@/lib/report-summary";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { PrintButton } from "@/components/print-button";

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
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Monthly summary" />;

  const s = await createClient();
  const summary = await getSubmissionSummary(s, lodge, month);
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";

  return (
    <div>
      <style>{`@media print { aside, header { display: none !important; } main { padding: 0 !important; } .no-print { display: none !important; } }`}</style>

      <PageHeader
        title="Monthly summary"
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

      {!summary.hasData && (
        <div className="mb-6 rounded-xl border border-sand-200 bg-white p-6 text-center text-sand-500">
          No monthly report submitted for {lodgeName} in {summary.label} yet.
        </div>
      )}

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
          <h3 className="mb-2 text-base">Safaris</h3>
          <Row label="Total safaris" value={summary.safaris} />
          <Row
            label="Report status"
            value={summary.status ? summary.status : "—"}
          />
        </div>
      </div>
    </div>
  );
}
