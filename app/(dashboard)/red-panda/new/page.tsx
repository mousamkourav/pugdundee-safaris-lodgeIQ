import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRpUser, loadRpMaster } from "@/lib/redpanda/server";
import { createClient } from "@/lib/supabase/server";
import { emptyRpPlan, isRedPandaPlan, sanitizeRpPlan } from "@/lib/redpanda/plan";
import { RedPandaBuilder } from "@/components/redpanda/builder";
import { ui } from "@/components/ui";

export const metadata = { title: "Red Panda quote - LodgeIQ" };

export default async function RedPandaNewPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireRpUser();
  const sp = await searchParams;
  const fromId = sp.from && /^[0-9a-f-]{36}$/i.test(sp.from) ? sp.from : null;
  const { master, error } = await loadRpMaster();
  if (!master) return <p className={ui.alertError}>Could not load Red Panda Master data: {error}. Has supabase/red_panda.sql been run?</p>;

  let initial = emptyRpPlan();
  let queryNo: string | null = null;
  let status: string | null = null;
  if (fromId) {
    const supabase = await createClient();
    const [q, v] = await Promise.all([
      supabase.from("sales_queries").select("id, query_no, status, query_type").eq("id", fromId).is("deleted_at", null).maybeSingle(),
      supabase.from("sales_itinerary_versions").select("plan").eq("query_id", fromId).order("version_no", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const row = q.data as { query_no: string; status: string; query_type?: string } | null;
    if (!row || row.query_type !== "red_panda") notFound();
    const plan = (v.data as { plan?: unknown } | null)?.plan;
    if (isRedPandaPlan(plan)) initial = sanitizeRpPlan(plan);
    queryNo = row.query_no;
    status = row.status;
    if (status === "lost" || status === "cancelled")
      return (
        <p className={ui.alertWarning}>
          This quote is {status}. Reopen it on <Link href={`/red-panda/quotes/${fromId}`} className="underline">its page</Link> before making a new version.
        </p>
      );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Red Panda Outpost</p>
        <h1 className="mt-1 text-2xl">{queryNo ? (status === "draft" ? `Draft ${queryNo}` : `New version of ${queryNo}`) : "New Red Panda quote"}</h1>
      </div>
      <RedPandaBuilder master={master} initial={initial} queryId={fromId} queryNo={queryNo} status={status} />
    </div>
  );
}
