import { requireUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge, lodgeSlug } from "@/lib/lodges";
import { Icon } from "@/components/icons";
import { currentMonth, monthRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditReportData, reportOwner } from "@/lib/monthly";
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
  const [{ user, profile }, sp, lodges] = await Promise.all([
    requireUser(),
    searchParams,
    getAccessibleLodges(),
  ]);
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Monthly report" />;

  const { start, label } = monthRange(month);
  const admin = isAdmin(profile?.role);
  const s = await createClient();

  const [yy0, mm0] = start.split("-").map(Number);
  const prevDate = new Date(Date.UTC(yy0, mm0 - 2, 1));
  const prevStart = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}-01`;

  // Independent reads, fired together: one round-trip of latency instead of four.
  const [{ data: rowData }, { data: draftRows }, { data: prevRow }, { data: erRows }] =
    await Promise.all([
      s
        .from("monthly_submissions")
        .select("*")
        .eq("lodge_id", lodge)
        .eq("month", start)
        .maybeSingle(),
      // Drafts in progress (user's accessible lodges via RLS), newest first.
      s
        .from("monthly_submissions")
        .select("lodge_id, month")
        .eq("status", "draft")
        .order("month", { ascending: false })
        .limit(24),
      s
        .from("monthly_submissions")
        .select("data")
        .eq("lodge_id", lodge)
        .eq("month", prevStart)
        .maybeSingle(),
      // Edit-request state for this lodge+month (latest pending/approved).
      s
        .from("edit_requests")
        .select("status")
        .eq("lodge_id", lodge)
        .eq("month", start)
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

  const row = rowData as Record<string, unknown> | null;
  const data = (row?.data as Record<string, unknown>) ?? {};

  const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const drafts = ((draftRows ?? []) as Array<{ lodge_id: string; month: string }>).map((dr) => {
    const ln = lodges.find((l) => l.id === dr.lodge_id)?.name ?? "Lodge";
    const ym = String(dr.month).slice(0, 7);
    const [yy, mmv] = ym.split("-");
    return { key: dr.lodge_id + ym, lodgeName: ln, slug: lodgeSlug(ln), ym, label: `${MONTH_NAMES[Number(mmv)] ?? mmv} ${yy}` };
  });

  // Energy carry-forward: prefill this month's opening from last month's closing
  // (matched by asset name). Only fills blanks; the manager can still edit.
  {
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

  const editReq = (erRows as Array<{ status: string }> | null)?.[0] ?? null;
  const editPending = editReq?.status === "pending";
  // Only the report's creator may edit its data; admins keep their overrides
  // (approve/decline, reopen, delete) but not field editing on others' reports.
  const canEditData = canEditReportData(row, user.id, admin);
  // The creator gets read-only once submitted (admins who created it can still edit).
  const submittedLock = submitted && !admin;
  const locked = !canEditData || submittedLock;
  // The edit-request path only helps someone who may edit once it is reopened.
  const showRequestEdit = canEditData && submittedLock;
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";

  // Who owns it, for the read-only note (service role: managers cannot read
  // other users' profiles).
  const owner = reportOwner(row);
  let ownerName: string | null = null;
  if (!canEditData && owner) {
    const { data: op } = await createAdminClient()
      .from("profiles")
      .select("full_name")
      .eq("id", owner)
      .maybeSingle();
    ownerName = (op as { full_name: string | null } | null)?.full_name ?? null;
  }
  const readOnlyNote = canEditData
    ? null
    : owner
      ? `Read-only: only ${ownerName ?? "the person who created this report"} can edit it.`
      : "Read-only: only the lodge's manager can edit this report's fields.";

  const statusUi = submitted
    ? { t: "Submitted", cls: "border-success-border bg-success-bg text-success", dot: "bg-success" }
    : status === "draft"
      ? { t: "Draft in progress", cls: "border-pending-border bg-pending-bg text-warning", dot: "bg-pending" }
      : { t: "Not started", cls: "border-sand-200 bg-sand-100 text-sand-600", dot: "bg-sand-400" };
  const btnSm =
    "inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition sm:min-h-9";

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <span>Reporting</span>
            <span aria-hidden="true">/</span>
            <span className="text-olive-700">{lodgeName}</span>
            <span aria-hidden="true">/</span>
            <span>Monthly operational submission</span>
          </>
        }
        title={`${label} report`}
        description={`Monthly report for ${lodgeName}. Figures roll up into the dashboards and summaries.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {drafts.length > 0 && (
        <div className="mb-6 rounded-xl border border-pending-border bg-pending-bg/40 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
            <Icon name="clock" className="h-4 w-4" />
            Drafts in progress - continue where you left off
          </p>
          <div className="flex flex-wrap gap-2">
            {drafts.map((dr) => (
              <a
                key={dr.key}
                href={`/monthly?lodge=${encodeURIComponent(dr.slug)}&month=${dr.ym}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm font-medium text-sand-700 transition hover:border-olive-600 hover:text-olive-800"
              >
                {dr.lodgeName} - {dr.label}
                <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* status banner */}
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-card sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow">Status</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusUi.cls}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusUi.dot}`} aria-hidden="true" />
            {statusUi.t}
          </span>
          {showRequestEdit && (
            <span className="text-sm text-sand-500">
              Submitted and locked.
            </span>
          )}
          {readOnlyNote && (
            <span className="text-sm text-sand-500">{readOnlyNote}</span>
          )}
        </div>
        {showRequestEdit && !editPending && (
          <form action={requestEdit}>
            <input type="hidden" name="lodge_id" value={lodge} />
            <input type="hidden" name="month" value={month} />
            <button className={`${btnSm} border border-olive-600 bg-white text-olive-700 hover:bg-olive-50`}>
              Request edit access
            </button>
          </form>
        )}
        {showRequestEdit && editPending && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-pending-border bg-pending-bg px-2.5 py-0.5 text-xs font-semibold text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-pending" aria-hidden="true" />
            Edit request pending approval
          </span>
        )}
        {admin && editPending && (
          <div className="flex flex-wrap gap-2">
            <form action={approveEdit}>
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="back" value={`/monthly?lodge=${lodge}&month=${month}`} />
              <button className={`${btnSm} bg-olive-600 font-semibold text-white hover:bg-olive-700`}>
                Approve edit
              </button>
            </form>
            <form action={declineEdit}>
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="back" value={`/monthly?lodge=${lodge}&month=${month}`} />
              <button className={`${btnSm} border border-error-border bg-white text-error hover:bg-error-bg`}>
                Decline
              </button>
            </form>
          </div>
        )}
        {admin && row && (
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {submitted && (
              <form action={reopenReport}>
                <input type="hidden" name="id" value={String(row.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className={`${btnSm} border border-sand-300 bg-white text-sand-700 hover:border-sand-500 hover:bg-sand-100`}>
                  Reopen for editing
                </button>
              </form>
            )}
            {isSuperAdmin(profile?.role) && (
              <form action={deleteReport}>
                <input type="hidden" name="id" value={String(row.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <button className={`${btnSm} border border-error-border bg-white text-error hover:bg-error-bg`}>
                  Delete
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* key: the form seeds its state from initialData once. Without a key,
          switching lodge/month via the picker (client navigation) kept the
          previous month's state on screen - and saving it wrote that data into
          the newly selected month. Remount on every lodge+month change. */}
      <MonthlyForm
        key={`${lodge}:${month}`}
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
