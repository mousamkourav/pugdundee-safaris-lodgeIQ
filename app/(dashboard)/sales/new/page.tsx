import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Builder } from "@/components/sales/builder/builder";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { defaultVehicle, emptyPlan } from "@/lib/sales/plan/planner";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import type { Plan } from "@/lib/sales/plan/types";
import { aiEnabled } from "./ai-actions";

// The trip assistant's AI reading runs as a server action on this page: allow it up to
// 60 s (Vercel's default can be 10 s, and a slow AI answer then reloaded the page).
export const maxDuration = 60;

export default async function NewItineraryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; step?: string }>;
}) {
  const { profile } = await requireUser();
  const sp = await searchParams;
  const fromId = sp.from ?? null;
  const startStep = sp.step === "draft" ? 2 : sp.step === "plan" ? 1 : 0;
  const today = todayIST();
  const { ctx, error } = await loadBuilderContext();

  let initial: Plan = emptyPlan(today);
  let queryNo: string | null = null;
  let queryStatus: string | null = null;
  if (fromId) {
    const supabase = await createClient();
    const { data: q } = await supabase.from("sales_queries").select("id, query_no, status").eq("id", fromId).is("deleted_at", null).maybeSingle();
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
    queryStatus = (q as { status: string }).status;
  }

  const aiAvailable = await aiEnabled();
  const ready = ctx.pricing.parks.length > 0 && ctx.properties.length > 0 && ctx.pricing.roomRates.length > 0;

  // a new itinerary starts with the Innova (saved ones keep their own choice)
  if (!fromId && !initial.vehicle_type) initial = { ...initial, vehicle_type: defaultVehicle(ctx) };

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Sales</p>
        <h1 className="mt-1 text-xl">{queryNo ? (queryStatus === "draft" ? `Draft ${queryNo}` : `New version of ${queryNo}`) : "Create itinerary"}</h1>
        {queryNo && (
          <p className="mt-1 text-sm text-sand-500">
            {queryStatus === "draft"
              ? "Continue where you left off. Save draft keeps your work; when it is ready, go to Final draft and save it for the guest."
              : "Saving creates a new version; earlier versions are kept, and the old client links keep working."}
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
        <Builder ctx={ctx} initial={initial} queryId={fromId} queryNo={queryNo} today={today} aiAvailable={aiAvailable} startStep={startStep} queryStatus={queryStatus} isAdmin={isSalesAdmin(profile?.role)} />
      )}
    </div>
  );
}
