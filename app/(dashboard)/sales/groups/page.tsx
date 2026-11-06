import Link from "next/link";
import { isSalesAdmin } from "@/lib/auth";
import { requireGroupUser } from "@/lib/sales/group/server";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { QueriesTable } from "@/components/sales/queries-table";
import { getMemberNames } from "@/lib/sales/members";
import { QUERY_LIST_COLUMNS, type QueryRow } from "@/lib/sales/status";

export const metadata = { title: "Group quotes - LodgeIQ" };

// Sales > Group quotes: the queries of type "group" (also in Sales > Queries, type "Group").
export default async function GroupQuotesPage() {
  const { user, profile } = await requireGroupUser();
  const admin = isSalesAdmin(profile?.role);
  const supabase = await createClient();
  let q = supabase.from("sales_queries").select(`${QUERY_LIST_COLUMNS}, query_type`).is("deleted_at", null).eq("query_type", "group");
  if (!admin) q = q.eq("assigned_to", user.id);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  const rows = ((data ?? []) as unknown as QueryRow[]).map((r) => ({ ...r, query_type: undefined }));
  const names = admin ? (await getMemberNames(rows.map((r) => r.assigned_to).filter((x): x is string => !!x))).names : {};
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Sales</p>
          <h1 className="mt-1 text-2xl">{admin ? "Group quotes" : "My group quotes"}</h1>
          <p className="mt-1 text-sm text-sand-500">Quotes for tour operators&apos; groups, priced by group size.</p>
        </div>
        <Link href="/sales/groups/new" className={ui.btnPrimary}>
          <Icon name="plus" className="h-[18px] w-[18px]" />
          Create group quote
        </Link>
      </div>
      {error && <p className={ui.alertError}>Could not load the group quotes: {/query_type/.test(error.message) ? "run supabase/sales_group_quotes.sql in Supabase first." : error.message}</p>}
      <QueriesTable rows={rows} memberNames={names} showMember={admin} empty="No group quotes yet." />
    </div>
  );
}
