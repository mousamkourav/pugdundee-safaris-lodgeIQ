import Link from "next/link";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatCard } from "@/components/sales/stat-card";
import { QueriesTable } from "@/components/sales/queries-table";
import { RangePicker } from "@/components/sales/range-picker";
import { getMemberNames } from "@/lib/sales/members";
import { rupees } from "@/lib/sales/format";
import { QUERY_LIST_COLUMNS, type QueryRow } from "@/lib/sales/status";
import { resolveDashboardRange, RANGE_LABEL } from "@/lib/sales/dashboard-range";
import { summarise, conversion as pct, followUps, byMember, type Totals } from "@/lib/sales/dashboard-summary";

// Supabase returns at most 1000 rows per request, so the period is read page by page
// (a single .limit(5000) silently stopped at 1000 queries).
const PAGE = 1000;
const MAX_ROWS = 50_000;

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { user, profile } = await requireUser();
  const admin = isSalesAdmin(profile?.role);
  // Default = all time; ?range=month|last|last3|year|custom (&from&to)
  const range = resolveDashboardRange(await searchParams);
  const supabase = await createClient();

  // Every query of the period (RLS already limits members to their own queries).
  const period: QueryRow[] = [];
  let error: { message: string } | null = null;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = supabase.from("sales_queries").select(QUERY_LIST_COLUMNS).is("deleted_at", null);
    if (range.from) q = q.gte("created_at", range.from);
    if (range.to) q = q.lt("created_at", range.to);
    if (!admin) q = q.eq("assigned_to", user.id);
    const { data, error: e } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (e) {
      error = e;
      break;
    }
    const rows = (data ?? []) as unknown as QueryRow[];
    period.push(...rows);
    if (rows.length < PAGE) break;
  }
  const t = summarise(period);

  // Follow-up list: open and quoted queries of the same period, newest first.
  const openRows = followUps(period, 50);
  const openCount = t.open + t.quoted;

  // Admin: per-member performance for the period.
  let team: { id: string; name: string; t: Totals }[] = [];
  let names: Record<string, string> = {};
  if (admin) {
    const res = await getMemberNames(period.map((r) => r.assigned_to).filter((x): x is string => !!x));
    names = res.names;
    team = byMember(period, res.members, names);
  }

  const first = (profile?.full_name || "").split(" ")[0] || "there";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{admin ? "Sales overview" : "My dashboard"}</p>
          <h1 className="mt-1 text-2xl">{admin ? "All members" : `Hello, ${first}`}</h1>
          {/* the period counted, so an empty period is never mistaken for lost data */}
          <p className="mt-1 text-sm text-sand-500">
            <span className="font-medium text-sand-700">{RANGE_LABEL[range.key]}:</span> {range.label} ({period.length}{" "}
            {period.length === 1 ? "query" : "queries"})
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <RangePicker key={`${range.key}-${range.fromDay}-${range.toDay}`} value={range.key} fromDay={range.fromDay} toDay={range.toDay} />
          <Link href="/sales/new" className={ui.btnPrimary}>
            <Icon name="clipboard" className="h-[18px] w-[18px]" />
            Create itinerary
          </Link>
        </div>
      </div>

      {error && <p className={ui.alertError}>Could not load queries: {error.message}</p>}
      {range.note && <p className={ui.alertWarning}>{range.note}</p>}
      {!error && range.key !== "all" && !period.length && (
        <p className={ui.alertWarning}>
          No queries were created in this period. Your other queries are safe: choose{" "}
          <Link href="/sales" className="font-semibold underline">All time</Link> to see every query.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Created" value={t.created} />
        <StatCard label="Booked" value={t.booked} valueClass="!text-success" hint={`Conversion ${pct(t)}%`} />
        <StatCard label="Open" value={t.open} valueClass="!text-warning" />
        <StatCard label="Quoted" value={t.quoted} hint="Sent, awaiting reply" />
        <StatCard label="Lost / cancelled" value={`${t.lost} / ${t.cancelled}`} />
        <Link href="/sales/queries?status=draft" className="block">
          <StatCard label="Drafts" value={t.draft} hint="Saved, not yet sent" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Booked value" value={rupees(t.bookedValue)} hint="Trip totals of booked quotes" highlight />
        <StatCard label="Received" value={rupees(t.received)} hint="Payments recorded at booking" />
        <StatCard label="Pending value" value={rupees(t.pendingValue)} hint={range.key === "all" ? "Open and quoted, all time" : "Open and quoted in this period"} />
      </div>

      {admin && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg">Member performance</h2>
              <p className="text-sm text-sand-500">{RANGE_LABEL[range.key]}. Click a member to see their queries.</p>
            </div>
            <Link href="/sales/members" className={`${ui.btnGhost} ${ui.btnSm}`}>Manage members</Link>
          </div>
          {team.length === 0 ? (
            <div className={ui.empty}>No sales members yet. Add them under Sales admin, Members.</div>
          ) : (
            <div className={`${ui.card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3 text-right">Created</th>
                      <th className="px-4 py-3 text-right">Booked</th>
                      <th className="px-4 py-3 text-right">Open</th>
                      <th className="px-4 py-3 text-right">Lost</th>
                      <th className="px-4 py-3 text-right">Cancelled</th>
                      <th className="px-4 py-3">Conversion</th>
                      <th className="px-4 py-3 text-right">Booked value</th>
                      <th className="px-4 py-3 text-right">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.map((m) => {
                      const c = pct(m.t);
                      return (
                        <tr key={m.id} className="border-t border-sand-200 hover:bg-sand-50">
                          <td className="px-4 py-3">
                            <Link href={`/sales/queries?member=${m.id}`} className="font-medium text-olive-800 hover:underline">
                              {m.name}
                            </Link>
                          </td>
                          <td className="tabular px-4 py-3 text-right">{m.t.created}</td>
                          <td className="tabular px-4 py-3 text-right text-success">{m.t.booked}</td>
                          <td className="tabular px-4 py-3 text-right">{m.t.open}</td>
                          <td className="tabular px-4 py-3 text-right">{m.t.lost}</td>
                          <td className="tabular px-4 py-3 text-right">{m.t.cancelled}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-sand-100">
                                <div className="h-1.5 rounded-full bg-olive-600" style={{ width: `${c}%` }} />
                              </div>
                              <span className="tabular text-xs">{c}%</span>
                            </div>
                          </td>
                          <td className="tabular px-4 py-3 text-right font-medium">{rupees(m.t.bookedValue)}</td>
                          <td className="tabular px-4 py-3 text-right">{rupees(m.t.received)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="mb-3">
          <h2 className="text-lg">Open queries - follow up</h2>
          <p className="text-sm text-sand-500">
            Open and quoted queries of the period ({openCount}), newest first
            {openCount > openRows.length ? `; the latest ${openRows.length} are shown` : ""}. Anything open more than 5 days is highlighted.
          </p>
        </div>
        <QueriesTable
          rows={openRows}
          memberNames={names}
          showMember={admin}
          showAge
          empty={range.key === "all" ? "No open queries. Create an itinerary to start one." : "No open or quoted queries were created in this period."}
        />
      </section>
    </div>
  );
}
