import Link from "next/link";
import { isSalesAdmin } from "@/lib/auth";
import { requireRpUser } from "@/lib/redpanda/server";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { QueriesTable } from "@/components/sales/queries-table";
import { getMemberNames } from "@/lib/sales/members";
import { QUERY_LIST_COLUMNS, type QueryRow } from "@/lib/sales/status";

export const metadata = { title: "Red Panda - LodgeIQ" };

// The Red Panda quotes: Sales queries of type red_panda (also in Sales > Queries, filter "Red Panda").
export default async function RedPandaPage() {
  const { user, profile } = await requireRpUser();
  const admin = isSalesAdmin(profile?.role);
  const supabase = await createClient();
  let q = supabase.from("sales_queries").select(`${QUERY_LIST_COLUMNS}, query_type`).is("deleted_at", null).eq("query_type", "red_panda");
  if (!admin) q = q.eq("assigned_to", user.id);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200);
  const rows = ((data ?? []) as unknown as QueryRow[]).map((r) => ({ ...r, query_type: undefined }));
  const names = admin ? (await getMemberNames(rows.map((r) => r.assigned_to).filter((x): x is string => !!x))).names : {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Red Panda Outpost</p>
          <h1 className="mt-1 text-2xl">{admin ? "Red Panda quotes" : "My Red Panda quotes"}</h1>
        </div>
        <Link href="/red-panda/new" className={ui.btnPrimary}>
          <Icon name="plus" className="h-[18px] w-[18px]" />
          New quote
        </Link>
      </div>
      {error && <p className={ui.alertError}>Could not load the quotes: {/query_type/.test(error.message) ? "run supabase/red_panda.sql in Supabase first." : error.message}</p>}
      <QueriesTable rows={rows} memberNames={names} showMember={admin} empty="No Red Panda quotes yet." />
    </div>
  );
}
