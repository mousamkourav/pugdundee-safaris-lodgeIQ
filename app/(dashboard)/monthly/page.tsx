import { requireUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { MonthlyForm } from "@/components/monthly-form";
import { saveDraft, submitReport, reopenReport, deleteReport } from "./actions";

export default async function MonthlyPage({
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

  const { start, label } = monthRange(month);
  const admin = isAdmin(profile?.role);
  const s = await createClient();
  const { data: rowData } = await s
    .from("monthly_submissions")
    .select("*")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .maybeSingle();

  const row = rowData as Record<string, unknown> | null;
  const data = (row?.data as Record<string, unknown>) ?? {};
  const status = (row?.status as string) ?? "none";
  const submitted = status === "submitted";
  // Managers get read-only once submitted; admins can always edit.
  const locked = submitted && !admin;
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";

  return (
    <div>
      <PageHeader title="Monthly report" description={`${lodgeName} · ${label}`} />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {/* status banner */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-sand-200 bg-white p-4">
        <span className="text-sm text-sand-600">Status:</span>
        <span
          className={
            "rounded-full px-3 py-1 text-xs capitalize " +
            (submitted
              ? "bg-success-bg text-success"
              : status === "draft"
              ? "bg-warning-bg text-warning"
              : "bg-sand-100 text-sand-600")
          }
        >
          {status === "none" ? "Not started" : status}
        </span>
        {locked && (
          <span className="text-sm text-sand-500">
            Submitted and locked. Contact an administrator to make changes.
          </span>
        )}
        {admin && row && (
          <div className="ml-auto flex gap-2">
            {submitted && (
              <form action={reopenReport}>
                <input type="hidden" name="id" value={String(row.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50">
                  Reopen for editing
                </button>
              </form>
            )}
            {isSuperAdmin(profile?.role) && (
              <form action={deleteReport}>
                <input type="hidden" name="id" value={String(row.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className="rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error-bg">
                  Delete
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <MonthlyForm
        initialData={data}
        locked={locked}
        admin={admin}
        lodge={lodge}
        lodgeName={lodgeName}
        month={month}
        saveDraft={saveDraft}
        submitReport={submitReport}
      />
    </div>
  );
}
