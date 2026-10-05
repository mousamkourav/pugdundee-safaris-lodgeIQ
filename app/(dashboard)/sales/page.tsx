import Link from "next/link";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatCard } from "@/components/sales/stat-card";
import { QueriesTable } from "@/components/sales/queries-table";
import { getMemberNames } from "@/lib/sales/members";
import { rupees, startOfMonthIST } from "@/lib/sales/format";
import { QUERY_LIST_COLUMNS, type QueryRow } from "@/lib/sales/status";

type Range = "month" | "all";

interface Totals {
  created: number;
  open: number;
  booked: number;
  lost: number;
  cancelled: number;
  bookedValue: number;
  pendingValue: number;
}

function summarise(rows: QueryRow[]): Totals {
  const t: Totals = { created: 0, open: 0, booked: 0, lost: 0, cancelled: 0, bookedValue: 0, pendingValue: 0 };
  for (const r of rows) {
    t.created += 1;
    t[r.status] += 1;
    if (r.status === "booked") t.bookedValue += Number(r.booked_amount ?? r.total_amount ?? 0);
    if (r.status === "open") t.pendingValue += Number(r.total_amount ?? 0);
  }
  return t;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { user, profile } = await requireUser();
  const admin = isSuperAdmin(profile?.role);
  const range: Range = (await searchParams).range === "all" ? "all" : "month";
  const supabase = await createClient();

  // Period rows (RLS already limits members to their own queries).
  let periodQ = supabase.from("sales_queries").select(QUERY_LIST_COLUMNS);
  if (range === "month") periodQ = periodQ.gte("created_at", startOfMonthIST());
  if (!admin) periodQ = periodQ.eq("assigned_to", user.id);
  const { data: periodData, error } = await periodQ.limit(5000);
  const period = (periodData ?? []) as unknown as QueryRow[];
  const t = summarise(period);

  // Follow-up list: every open query regardless of period, oldest first.
  let openQ = supabase.from("sales_queries").select(QUERY_LIST_COLUMNS).eq("status", "open");
  if (!admin) openQ = openQ.eq("assigned_to", user.id);
  const { data: openData } = await openQ.order("created_at", { ascending: true }).limit(10);
  const openRows = (openData ?? []) as unknown as QueryRow[];

  // Admin: per-member performance.
  let team: { id: string; name: string; t: Totals }[] = [];
  let names: Record<string, string> = {};
  if (admin) {
    const ids = [...period, ...openRows].map((r) => r.assigned_to).filter((x): x is string => !!x);
    const res = await getMemberNames(ids);
    names = res.names;
    const byMember = new Map<string, QueryRow[]>();
    for (const r of period) {
      if (!r.assigned_to) continue;
      byMember.set(r.assigned_to, [...(byMember.get(r.assigned_to) ?? []), r]);
    }
    // Include active members with zero queries so nobody is missing from the table.
    for (const m of res.members) if (m.status !== "disabled" && !byMember.has(m.id)) byMember.set(m.id, []);
    team = [...byMember.entries()]
      .map(([id, rows]) => ({ id, name: names[id] ?? "Unknown", t: summarise(rows) }))
      .sort((a, b) => b.t.bookedValue - a.t.bookedValue || b.t.created - a.t.created);
  }

  const first = (profile?.full_name || "").split(" ")[0] || "there";
  const tab = (r: Range, label: string) => (
    <Link
      href={r === "month" ? "/sales" : "/sales?range=all"}
      className={
        "rounded-md px-3 py-1.5 font-medium transition " +
        (range === r ? "bg-white text-olive-800 shadow-card" : "text-sand-500 hover:text-olive-800")
      }
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">{admin ? "Sales overview" : "My dashboard"}</p>
          <h1 className="mt-1 text-2xl">{admin ? "All members" : `Hello, ${first}`}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-sand-200 bg-sand-100 p-1 text-sm">
            {tab("month", "This month")}
            {tab("all", "All time")}
          </div>
          <Link href="/sales/new" className={ui.btnPrimary}>
            <Icon name="clipboard" className="h-[18px] w-[18px]" />
            Create itinerary
          </Link>
        </div>
      </div>

      {error && <p className={ui.alertError}>Could not load queries: {error.message}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Created" value={t.created} />
        <StatCard label="Booked" value={t.booked} valueClass="!text-success" hint={`Conversion ${pct(t.booked, t.created)}%`} />
        <StatCard label="Open" value={t.open} valueClass="!text-warning" />
        <StatCard label="Lost / cancelled" value={`${t.lost} / ${t.cancelled}`} />
        <StatCard label="Booked value" value={rupees(t.bookedValue)} highlight />
        <StatCard label="Pending value" value={rupees(t.pendingValue)} hint="Open queries in this period" />
      </div>

      {admin && (
        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg">Member performance</h2>
              <p className="text-sm text-sand-500">Click a member to see their queries.</p>
            </div>
            <Link href="/admin/users" className={`${ui.btnGhost} ${ui.btnSm}`}>Manage members</Link>
          </div>
          {team.length === 0 ? (
            <div className={ui.empty}>No sales members yet. Add one from Users &amp; access with the role Sales member.</div>
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
                    </tr>
                  </thead>
                  <tbody>
                    {team.map((m) => {
                      const c = pct(m.t.booked, m.t.created);
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
          <p className="text-sm text-sand-500">Oldest first. Anything open more than 5 days is highlighted.</p>
        </div>
        <QueriesTable
          rows={openRows}
          memberNames={names}
          showMember={admin}
          showAge
          empty="No open queries. Create an itinerary to start one."
        />
      </section>
    </div>
  );
}
