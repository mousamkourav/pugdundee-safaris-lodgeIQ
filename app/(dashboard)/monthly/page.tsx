import { requireUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { MonthlyForm } from "@/components/monthly-form";
import { saveDraft, submitReport, reopenReport, deleteReport } from "./actions";
import { requestEdit, approveEdit, declineEdit } from "./edit-requests";

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

  // Energy carry-forward: prefill this month's opening from last month's closing
  // (matched by asset name). Only fills blanks; the manager can still edit.
  {
    const [yy, mm] = start.split("-").map(Number);
    const prevDate = new Date(Date.UTC(yy, mm - 2, 1));
    const prevStart = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { data: prevRow } = await s
      .from("monthly_submissions")
      .select("data")
      .eq("lodge_id", lodge)
      .eq("month", prevStart)
      .maybeSingle();
    const prevEnergy = ((prevRow as { data?: { energy?: Array<Record<string, unknown>> } } | null)?.data?.energy) ?? [];
    const namedPrev = prevEnergy.filter((e) => String(e?.asset ?? "").trim() !== "");
    if (namedPrev.length > 0) {
      const cur = (data.energy as Array<Record<string, unknown>> | undefined) ?? [];
      const curNamed = cur.some((e) => String(e?.asset ?? "").trim() !== "");
      if (!curNamed) {
        // Fresh month: nothing typed yet, so seed the asset names too. Without
        // this the carry-forward could never fire, because it matches on a name
        // the manager had not entered yet.
        data.energy = namedPrev.map((e) => ({ asset: e.asset, opening: e.closing }));
      } else {
        // Partially filled month: only fill blank openings, matched by asset.
        const closingByAsset = new Map<string, unknown>();
        for (const e of namedPrev) {
          closingByAsset.set(String(e.asset).trim(), e?.closing);
        }
        data.energy = cur.map((e) => {
          const name = String(e?.asset ?? "").trim();
          const openBlank = e?.opening === undefined || e?.opening === null || e?.opening === "";
          if (openBlank && closingByAsset.has(name)) {
            return { ...e, opening: closingByAsset.get(name) };
          }
          return e;
        });
      }
    }
  }
  const status = (row?.status as string) ?? "none";
  const submitted = status === "submitted";

  // Edit-request state for this lodge+month (latest pending/approved).
  const { data: erRows } = await s
    .from("edit_requests")
    .select("status")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);
  const editReq = (erRows as Array<{ status: string }> | null)?.[0] ?? null;
  const editPending = editReq?.status === "pending";
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
            Submitted and locked.
          </span>
        )}
        {locked && !editPending && (
          <form action={requestEdit}>
            <input type="hidden" name="lodge_id" value={lodge} />
            <input type="hidden" name="month" value={month} />
            <button className="rounded-lg border border-olive-600 px-3 py-1.5 text-sm text-olive-700 hover:bg-olive-50">
              Request edit access
            </button>
          </form>
        )}
        {locked && editPending && (
          <span className="rounded-full bg-warning-bg px-3 py-1 text-xs text-warning">
            Edit request pending approval
          </span>
        )}
        {admin && editPending && (
          <div className="flex gap-2">
            <form action={approveEdit}>
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="back" value={`/monthly?lodge=${lodge}&month=${month}`} />
              <button className="rounded-lg bg-olive-600 px-3 py-1.5 text-sm text-white hover:bg-olive-700">
                Approve edit
              </button>
            </form>
            <form action={declineEdit}>
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="back" value={`/monthly?lodge=${lodge}&month=${month}`} />
              <button className="rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error-bg">
                Decline
              </button>
            </form>
          </div>
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
