import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Builder } from "@/components/sales/builder/builder";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { emptyPlan } from "@/lib/sales/plan/planner";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import type { Plan } from "@/lib/sales/plan/types";
import { aiEnabled } from "./ai-actions";

export default async function NewItineraryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { profile } = await requireUser();
  const fromId = (await searchParams).from ?? null;
  const today = todayIST();
  const { ctx, error } = await loadBuilderContext();

  let initial: Plan = emptyPlan(today);
  let queryNo: string | null = null;
  if (fromId) {
    const supabase = await createClient();
    const { data: q } = await supabase.from("sales_queries").select("id, query_no, status").eq("id", fromId).maybeSingle();
    if (!q) notFound();
    const { data: v } = await supabase
      .from("sales_itinerary_versions")
      .select("plan")
      .eq("query_id", fromId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    const plan = sanitizePlan((v as { plan?: unknown } | null)?.plan);
    if (plan) initial = plan;
    queryNo = (q as { query_no: string }).query_no;
  }

  const aiAvailable = await aiEnabled();
  const ready = ctx.pricing.parks.length > 0 && ctx.properties.length > 0 && ctx.pricing.roomRates.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Sales</p>
        <h1 className="mt-1 text-2xl">{queryNo ? `New version of ${queryNo}` : "Create itinerary"}</h1>
        {queryNo && <p className="mt-1 text-sm text-sand-500">Saving creates a new version; earlier versions are kept.</p>}
      </div>
      {error && <p className={ui.alertError}>Could not load all master data: {error}</p>}
      {!ready ? (
        <div className={ui.empty}>
          Parks, lodges and room rates are needed before itineraries can be built.
          {isSuperAdmin(profile?.role) ? (
            <>
              {" "}
              <Link href="/sales/admin" className="font-semibold text-olive-600 underline">Open master data</Link>.
            </>
          ) : (
            " Ask an administrator to add them."
          )}
        </div>
      ) : (
        <Builder ctx={ctx} initial={initial} queryId={fromId} today={today} aiAvailable={aiAvailable} />
      )}
    </div>
  );
}
