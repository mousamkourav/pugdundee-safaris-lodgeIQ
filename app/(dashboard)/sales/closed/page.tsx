import Link from "next/link";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { QueriesTable } from "@/components/sales/queries-table";
import { getMemberNames } from "@/lib/sales/members";
import { QUERY_LIST_COLUMNS, type QueryRow } from "@/lib/sales/status";

export default async function ClosedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user, profile } = await requireUser();
  const admin = isSuperAdmin(profile?.role);
  const tab = (await searchParams).tab === "cancelled" ? "cancelled" : "lost";
  const supabase = await createClient();

  let q = supabase.from("sales_queries").select(QUERY_LIST_COLUMNS).eq("status", tab);
  if (!admin) q = q.eq("assigned_to", user.id);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as QueryRow[];

  // Latest remark for each query's move into this status (from the history table).
  const remarks: Record<string, string> = {};
  if (rows.length) {
    const { data: ev } = await supabase
      .from("sales_query_events")
      .select("query_id, remark, created_at")
      .in("query_id", rows.map((r) => r.id))
      .eq("event_type", "status")
      .eq("to_status", tab)
      .order("created_at", { ascending: false });
    for (const e of (ev ?? []) as { query_id: string; remark: string | null }[]) {
      if (!(e.query_id in remarks) && e.remark) remarks[e.query_id] = e.remark;
    }
  }

  const names = admin
    ? (await getMemberNames(rows.map((r) => r.assigned_to).filter((x): x is string => !!x))).names
    : {};

  const tabLink = (key: "lost" | "cancelled", label: string) => (
    <Link
      href={key === "lost" ? "/sales/closed" : "/sales/closed?tab=cancelled"}
      className={
        "-mb-px whitespace-nowrap border-b-2 py-3 font-medium " +
        (tab === key ? "border-olive-600 text-olive-800" : "border-transparent text-sand-500 hover:text-olive-800")
      }
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Sales</p>
        <h1 className="mt-1 text-2xl">Lost &amp; cancelled</h1>
        <p className="mt-1 text-sm text-sand-500">
          Lost: the guest never confirmed. Cancelled: booked, then cancelled. Any of these can be reopened with a remark.
        </p>
      </div>
      <div className="flex gap-6 border-b border-sand-200 text-sm">
        {tabLink("lost", "Lost")}
        {tabLink("cancelled", "Cancelled")}
      </div>
      {error && <p className={ui.alertError}>Could not load queries: {error.message}</p>}
      <QueriesTable
        rows={rows}
        memberNames={names}
        showMember={admin}
        remarks={remarks}
        empty={tab === "lost" ? "No lost queries." : "No cancelled bookings."}
      />
    </div>
  );
}
