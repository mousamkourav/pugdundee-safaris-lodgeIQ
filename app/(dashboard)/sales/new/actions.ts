"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import { planToTrip, routeProblems } from "@/lib/sales/plan/planner";
import { priceTrip } from "@/lib/sales/pricing/engine";

export type SaveResult = { id?: string; error?: string; problems?: string[] };

// Saves a new query (queryId null) or a new version of an existing one.
// The price is always recalculated here from current master data; the
// browser's numbers are never trusted.
export async function saveItinerary(planJson: string, queryId: string | null): Promise<SaveResult> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };

  let raw: unknown;
  try {
    raw = JSON.parse(planJson);
  } catch {
    return { error: "The itinerary could not be read. Reload the page and try again." };
  }
  const plan = sanitizePlan(raw);
  if (!plan) return { error: "The itinerary is missing its arrival date." };
  if (!plan.guest.name) return { error: "Enter the guest name." };
  if (!plan.days.length) return { error: "Build the day-by-day plan first." };

  const { ctx, error: loadError } = await loadBuilderContext();
  if (loadError) return { error: "Could not load master data: " + loadError };
  const problems = routeProblems(plan, ctx);
  if (problems.length) return { problems };

  const today = todayIST();
  const result = priceTrip(planToTrip(plan, today), ctx.pricing);
  if (result.errors.length) return { problems: result.errors };

  const parkNames = [...new Set(plan.stops.map((s) => ctx.pricing.parks.find((p) => p.id === s.park_id)?.name).filter(Boolean))] as string[];
  const queryFields = {
    guest_name: plan.guest.name,
    guest_email: plan.guest.email || null,
    guest_phone: plan.guest.phone || null,
    nationality: plan.guest.nationality,
    adults: plan.guest.adults,
    children: plan.guest.children,
    rooms: plan.guest.rooms,
    source: plan.guest.source || null,
    agent_name: plan.guest.agent_name || null,
    arrival_date: result.arrival,
    departure_date: result.departure,
    parks: parkNames,
  };
  const version = {
    plan,
    pricing: { ...result, priced_on: today },
    total_amount: result.totals.grand,
    currency: result.currency,
  };

  const supabase = await createClient();

  if (queryId) {
    const { data: existing } = await supabase.from("sales_queries").select("id, status").eq("id", queryId).maybeSingle();
    if (!existing) return { error: "Query not found, or it is not assigned to you." };
    const status = (existing as { status: string }).status;
    if (status === "lost" || status === "cancelled") return { error: "Reopen this query before creating a new version." };

    const up = await supabase.from("sales_queries").update(queryFields).eq("id", queryId);
    if (up.error) return { error: up.error.message };
    const ins = await supabase.from("sales_itinerary_versions").insert({ query_id: queryId, ...version });
    if (ins.error) return { error: ins.error.message };
    revalidatePath(`/sales/queries/${queryId}`);
    revalidatePath("/sales", "layout");
    return { id: queryId };
  }

  const q = await supabase.from("sales_queries").insert(queryFields).select("id").single();
  if (q.error) return { error: q.error.message };
  const id = (q.data as { id: string }).id;

  const ins = await supabase.from("sales_itinerary_versions").insert({ query_id: id, ...version });
  if (ins.error) {
    // Members cannot delete queries, so clean up with the service role.
    await createAdminClient().from("sales_queries").delete().eq("id", id);
    return { error: "Could not save the itinerary: " + ins.error.message };
  }
  revalidatePath("/sales", "layout");
  return { id };
}
