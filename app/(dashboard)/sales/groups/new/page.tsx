import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isSalesAdmin } from "@/lib/auth";
import { requireGroupUser } from "@/lib/sales/group/server";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Builder } from "@/components/sales/builder/builder";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { defaultVehicle, emptyPlan } from "@/lib/sales/plan/planner";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import type { Plan } from "@/lib/sales/plan/types";
import { aiEnabled } from "../../new/ai-actions";
import { logTiming } from "@/lib/timing";

// The trip assistant's AI reading runs as a server action on this page: allow it up to
// 60 s (Vercel's default can be 10 s, and a slow AI answer then reloaded the page).
export const maxDuration = 60;

// Sales > Create group quote: the same builder, Master data and rates as every quote, with the
// group's details (Trip), the costing sheet and the price by group size (Plan & price).
export default async function NewGroupQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; step?: string }>;
}) {
  const { profile } = await requireGroupUser();
  const sp = await searchParams;
  const fromId = sp.from ?? null;
  const startStep = sp.step === "draft" ? 3 : sp.step === "plan" ? 2 : sp.step === "confirm" ? 1 : 0;
  const today = todayIST();
  // master data, the query being edited (with its latest version) and the AI switch: all at once
  const supabase = await createClient();
  const started = performance.now();
  const [{ ctx, error }, q, v, aiAvailable] = await Promise.all([
    loadBuilderContext(),
    fromId ? supabase.from("sales_queries").select("id, query_no, status, query_type").eq("id", fromId).is("deleted_at", null).maybeSingle() : null,
    fromId ? supabase.from("sales_itinerary_versions").select("plan").eq("query_id", fromId).order("version_no", { ascending: false }).limit(1).maybeSingle() : null,
    aiEnabled(),
  ]);
  logTiming("page /sales/groups/new data", performance.now() - started);

  let initial: Plan = emptyPlan(today);
  let queryNo: string | null = null;
  let queryStatus: string | null = null;
  if (fromId) {
    if (!q?.data) notFound();
    // only group quotes open here
    if ((q.data as { query_type?: string }).query_type !== "group") redirect(`/sales/new?from=${fromId}`);
    const plan = sanitizePlan((v?.data as { plan?: unknown } | null)?.plan);
    if (plan) initial = plan;
    queryNo = (q.data as { query_no: string }).query_no;
    queryStatus = (q.data as { status: string }).status;
  }

  const ready = ctx.pricing.parks.length > 0 && ctx.properties.length > 0 && ctx.pricing.roomRates.length > 0;

  // a new itinerary starts with the Innova (saved ones keep their own choice)
  if (!fromId && !initial.vehicle_type) initial = { ...initial, vehicle_type: defaultVehicle(ctx) };

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Sales</p>
        <h1 className="mt-1 text-xl">{queryNo ? (queryStatus === "draft" ? `Group draft ${queryNo}` : `Edit group quote ${queryNo}`) : "Create group quote"}</h1>
        {!queryNo && <p className="mt-1 text-sm text-sand-500">Describe the trip as for any quote, fill in the group details, then the costing sheet and the price by group size on Plan & price.</p>}
        {queryNo && (
          <p className="mt-1 text-sm text-sand-500">
            {queryStatus === "draft"
              ? "Continue where you left off. Save draft keeps your work; when it is ready, go to Final draft and save it for the guest."
              : "When you save, choose: a new version (earlier versions and their client links are kept), or an update of the current version (a correction before sending, same link)."}
          </p>
        )}
      </div>
      {error && <p className={ui.alertError}>Could not load all master data: {error}</p>}
      {!ready ? (
        <div className={ui.empty}>
          Parks, lodges and room rates are needed before itineraries can be built.
          {isSalesAdmin(profile?.role) ? (
            <>
              {" "}
              <Link href="/sales/admin" className="font-semibold text-olive-600 underline">Open master data</Link>.
            </>
          ) : (
            " Ask an administrator to add them."
          )}
        </div>
      ) : (
        <Builder ctx={ctx} initial={initial} queryId={fromId} queryNo={queryNo} today={today} aiAvailable={aiAvailable} startStep={startStep} queryStatus={queryStatus} isAdmin={isSalesAdmin(profile?.role)} group />
      )}
    </div>
  );
}
