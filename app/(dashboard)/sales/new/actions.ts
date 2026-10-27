"use server";

import { safe } from "@/lib/sales/safe";
import { makeShareSlug } from "@/lib/sales/share-slug";
import { planToExample } from "@/lib/sales/plan/ai";
import { scrubForAI, unknownWords } from "@/lib/sales/plan/parse-text";
import { readerRows, suggestRules } from "@/lib/sales/plan/learn";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import type { Plan } from "@/lib/sales/plan/types";
import { planToTrip, routeProblems } from "@/lib/sales/plan/planner";
import { priceTrip } from "@/lib/sales/pricing/engine";

export type SaveResult = { id?: string; error?: string; problems?: string[] };
export type SaveMode = "draft" | "final";

// A version with its personalised client link (/i/sangeeta-ps-2026-0001-k8f3x9q2).
// If the random part ever clashes with an existing link, try again with a new one.
async function insertVersion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  queryId: string,
  queryNo: string,
  guestName: string,
  version: Record<string, unknown>
) {
  let res = await supabase.from("sales_itinerary_versions").insert({ query_id: queryId, ...version, share_slug: makeShareSlug(guestName, queryNo) });
  if (res.error && /share_slug|duplicate key/i.test(res.error.message)) {
    res = await supabase.from("sales_itinerary_versions").insert({ query_id: queryId, ...version, share_slug: makeShareSlug(guestName, queryNo) });
  }
  return res;
}

// mode "draft": saves whatever is there (even half-finished or with prices
//   missing) as a Draft that is not sent to the guest.
// mode "final": the full checks, then the query is Open with a client link.
// The price is always recalculated here from current master data and the
// prices the sales person typed; the browser's numbers are never trusted.
async function saveItineraryUnsafe(planJson: string, queryId: string | null, mode: SaveMode = "final", enquiry?: string, typed?: unknown): Promise<SaveResult> {
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

  const { ctx, error: loadError } = await loadBuilderContext();
  if (loadError) return { error: "Could not load master data: " + loadError };
  const today = todayIST();
  const problems = routeProblems(plan, ctx);
  const result = plan.days.length && !problems.length ? priceTrip(planToTrip(plan, today), ctx.pricing) : null;

  if (mode === "final") {
    if (!plan.guest.name) return { error: "Enter the guest name." };
    if (!plan.days.length) return { error: "Build the day plan first." };
    if (problems.length) return { problems };
    if (!result) return { error: "The trip could not be priced." };
    if (result.errors.length) return { problems: result.errors };
    const stillEmpty = result.missing.filter((m) => plan.manual_prices[m.key] === undefined);
    if (stillEmpty.length) {
      return { problems: stillEmpty.map((m) => `Price needed: ${m.label} (${m.unit}). Type it on the Plan & price step, or save a draft.`) };
    }
  }

  const parkNames = [...new Set(plan.stops.map((s) => ctx.pricing.parks.find((p) => p.id === s.park_id)?.name).filter(Boolean))] as string[];
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);
  const queryFields = {
    guest_name: plan.guest.name || `Untitled draft ${today}`,
    guest_email: plan.guest.email || null,
    guest_phone: plan.guest.phone || null,
    nationality: plan.guest.nationality,
    adults: plan.guest.adults,
    children: plan.guest.children,
    rooms: plan.guest.rooms,
    source: plan.guest.source || null,
    agent_name: plan.guest.agent_name || null,
    // dates not fixed: no travel dates on the query (the plan keeps a placeholder for the day order)
    arrival_date: plan.dateless ? null : result?.arrival ?? (plan.stops.length ? plan.arrival_date : null),
    departure_date: plan.dateless ? null : result?.departure ?? null,
    parks: parkNames,
  };
  const version = {
    plan,
    pricing: result ? { ...result, priced_on: today } : { priced_on: today, incomplete: true, nights },
    total_amount: result?.totals.grand ?? 0,
    currency: result?.currency ?? plan.currency,
  };

  const supabase = await createClient();

  if (queryId) {
    const { data: existing } = await supabase.from("sales_queries").select("id, status, query_no").eq("id", queryId).is("deleted_at", null).maybeSingle();
    if (!existing) return { error: "Query not found, or it is not assigned to you." };
    const status = (existing as { status: string }).status;
    if (status === "lost" || status === "cancelled") return { error: "Reopen this query before creating a new version." };
    if (mode === "draft" && status !== "draft") {
      return { error: "This quote has already been sent, so it cannot go back to draft. Save it as a new version instead." };
    }

    const up = await supabase.from("sales_queries").update(queryFields).eq("id", queryId);
    if (up.error) return { error: up.error.message };
    const ins = await insertVersion(supabase, queryId, (existing as { query_no: string }).query_no, queryFields.guest_name, version);
    if (ins.error) return { error: ins.error.message };
    if (mode === "final" && status === "draft") {
      const fin = await supabase.from("sales_queries").update({ status: "open" }).eq("id", queryId);
      if (fin.error) return { error: "Saved, but the draft could not be finalised: " + fin.error.message };
    }
    if (mode === "final") await learnFrom(supabase, enquiry, plan, ctx, queryId, cu.user.id);
    await teachReader(typed, enquiry, plan, ctx, today, cu.user.id, mode);
    revalidatePath(`/sales/queries/${queryId}`);
    revalidatePath("/sales", "layout");
    return { id: queryId };
  }

  const q = await supabase
    .from("sales_queries")
    .insert({ ...queryFields, status: mode === "draft" ? "draft" : "open" })
    .select("id, query_no")
    .single();
  if (q.error) return { error: q.error.message };
  const id = (q.data as { id: string }).id;

  const ins = await insertVersion(supabase, id, (q.data as { query_no: string }).query_no, queryFields.guest_name, version);
  if (ins.error) {
    // Members cannot delete queries, so clean up with the service role.
    await createAdminClient().from("sales_queries").delete().eq("id", id);
    return { error: "Could not save the itinerary: " + ins.error.message };
  }
  if (mode === "final") await learnFrom(supabase, enquiry, plan, ctx, id, cu.user.id);
  await teachReader(typed, enquiry, plan, ctx, today, cu.user.id, mode);
  revalidatePath("/sales", "layout");
  return { id };
}

// A quote saved for the guest becomes an example for the AI assistant: the
// enquiry as typed (without names or contact details) and the trip that was quoted.
async function learnFrom(
  supabase: Awaited<ReturnType<typeof createClient>>,
  enquiry: string | undefined,
  plan: Plan,
  ctx: Awaited<ReturnType<typeof loadBuilderContext>>["ctx"],
  queryId: string,
  userId: string
) {
  const text = scrubForAI(enquiry ?? "", [plan.guest.name]).trim();
  if (text.length < 15 || !plan.stops.length) return;
  await supabase
    .from("sales_chat_examples")
    .insert({ message: text, expected: planToExample(plan, ctx), query_id: queryId, created_by: userId })
    .then(() => undefined, () => undefined); // the table may not exist yet: never block a save
}

// Teaching the built-in reader (Master data > Reader rules / Unknown words): the words it
// could not place in the messages typed, and, for a quote saved for the guest, rules
// suggested from what the sales person changed. Names and contacts are removed first.
// Written with the service key (members cannot change rules); only a Sales admin approves.
async function teachReader(
  typed: unknown,
  enquiry: string | undefined,
  plan: Plan,
  ctx: Awaited<ReturnType<typeof loadBuilderContext>>["ctx"],
  today: string,
  userId: string,
  mode: SaveMode
) {
  try {
    const clean = (t: string) => scrubForAI(t.slice(0, 2000), [plan.guest.name]).trim();
    const messages = (Array.isArray(typed) ? typed : []).filter((t): t is string => typeof t === "string").slice(-20).map(clean);
    const first = clean(enquiry ?? "");
    const unknown = [...new Set(messages.flatMap((m) => unknownWords(m, ctx)))].slice(0, 20);
    const suggestions = mode === "final" && first ? suggestRules(first, plan, ctx, today) : [];
    const rows = readerRows(suggestions, unknown, first || messages[0] || "");
    if (!rows.length) return;
    const admin = createAdminClient();
    for (const r of rows) {
      const { data: found, error } = await admin.from("sales_reader_rules").select("id, seen").eq("source", r.source).ilike("phrase", r.phrase).maybeSingle();
      if (error) return; // the table is not there yet (sales_reader_rules.sql not run)
      if (found) await admin.from("sales_reader_rules").update({ seen: Number((found as { seen: number }).seen) + 1 }).eq("id", (found as { id: string }).id);
      else await admin.from("sales_reader_rules").insert({ ...r, status: "suggested", created_by: userId });
    }
  } catch {
    // never block a save
  }
}

// Public actions: same as above, but failures come back as { error } instead of crashing.
export async function saveItinerary(planJson: string, queryId: string | null, mode: SaveMode = "final", enquiry?: string, typed?: string[]): Promise<SaveResult> {
  return safe("saveItinerary", () => saveItineraryUnsafe(planJson, queryId, mode, enquiry, typed));
}
