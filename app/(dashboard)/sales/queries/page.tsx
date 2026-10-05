import Link from "next/link";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { QueriesTable } from "@/components/sales/queries-table";
import { getMemberNames } from "@/lib/sales/members";
import { QUERY_LIST_COLUMNS, QUERY_STATUSES, STATUS_LABEL, isQueryStatus, type QueryRow } from "@/lib/sales/status";

export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; member?: string; q?: string }>;
}) {
  const { user, profile } = await requireUser();
  const admin = isSuperAdmin(profile?.role);
  const sp = await searchParams;
  const status = isQueryStatus(sp.status) ? sp.status : null;
  const member = admin && sp.member ? sp.member : null;
  const search = (sp.q ?? "").trim();

  const supabase = await createClient();
  let query = supabase.from("sales_queries").select(QUERY_LIST_COLUMNS);
  if (!admin) query = query.eq("assigned_to", user.id);
  if (member) query = query.eq("assigned_to", member);
  if (status) query = query.eq("status", status);
  if (search) {
    // Commas and brackets would break the .or() filter syntax.
    const s = search.replace(/[,()]/g, " ");
    query = query.or(`guest_name.ilike.%${s}%,query_no.ilike.%${s}%`);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as unknown as QueryRow[];

  const names = admin
    ? (await getMemberNames(rows.map((r) => r.assigned_to).filter((x): x is string => !!x).concat(member ? [member] : []))).names
    : {};

  // Keep member + search when switching tabs.
  const href = (s: string | null) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (member) p.set("member", member);
    if (search) p.set("q", search);
    const qs = p.toString();
    return "/sales/queries" + (qs ? "?" + qs : "");
  };

  const tabs: { key: string | null; label: string }[] = [
    { key: null, label: "All" },
    ...QUERY_STATUSES.map((s) => ({ key: s as string, label: STATUS_LABEL[s] })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Sales</p>
          <h1 className="mt-1 text-2xl">
            {member ? `Queries - ${names[member] ?? "member"}` : admin ? "All queries" : "My queries"}
          </h1>
        </div>
        <form action="/sales/queries" className="flex w-full gap-2 md:w-auto">
          {status && <input type="hidden" name="status" value={status} />}
          {member && <input type="hidden" name="member" value={member} />}
          <input name="q" defaultValue={search} placeholder="Guest name or query no." className={`${ui.inputSm} md:w-64`} />
          <button className={`${ui.btnSecondary} ${ui.btnSm}`}>Search</button>
        </form>
      </div>

      <div className="no-scrollbar flex gap-6 overflow-x-auto border-b border-sand-200 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={href(t.key)}
            className={
              "-mb-px whitespace-nowrap border-b-2 py-3 font-medium " +
              (status === t.key ? "border-olive-600 text-olive-800" : "border-transparent text-sand-500 hover:text-olive-800")
            }
          >
            {t.label}
          </Link>
        ))}
        {member && (
          <Link href={"/sales/queries" + (status ? `?status=${status}` : "")} className="ml-auto whitespace-nowrap py-3 text-sm font-medium text-olive-600 hover:underline">
            Show all members
          </Link>
        )}
      </div>

      {error && <p className={ui.alertError}>Could not load queries: {error.message}</p>}

      <QueriesTable
        rows={rows}
        memberNames={names}
        showMember={admin && !member}
        empty={search ? "No queries match your search." : "No queries here yet."}
      />
      {rows.length === 200 && <p className="text-xs text-sand-500">Showing the latest 200. Use search to narrow down.</p>}
    </div>
  );
}
