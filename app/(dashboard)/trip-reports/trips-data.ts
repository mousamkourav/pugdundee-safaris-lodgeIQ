import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { lodgeSlug, type LodgeLite } from "@/lib/lodges";
import { isUuid, type Trip, type TaskStatus } from "@/lib/tasks";
import type { FilterOption } from "@/components/filter-select";

// A trip plus the task counts computed from its tasks.
export type TripWithCounts = Trip & {
  lodge_name: string;
  authority_name: string; // resolved display name (authority text, else creator)
  creator_name: string | null; // full_name of the account that logged the trip
  total: number;
  pending: number;
  submitted: number;
  resolved: number;
  declined: number;
};

// Roles that can create trips / tasks (canAssignTasks in lib/tasks.ts).
const ASSIGNER_ROLES = ["super_admin", "senior_manager", "task_creator"];

// id -> full_name via the service role (managers cannot read other profiles).
export async function profileNames(
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((v): v is string => !!v)));
  const names = new Map<string, string>();
  if (!uniq.length) return names;
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id,full_name")
    .in("id", uniq);
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    names.set(p.id, p.full_name?.trim() || "Unknown");
  }
  return names;
}

// "Created by" filter options: everyone who can assign trips/tasks (so the
// traveling chef appears even before her first trip), by name.
export async function assignerOptions(): Promise<FilterOption[]> {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id,full_name,role")
    .in("role", ASSIGNER_ROLES)
    .order("full_name");
  return ((data ?? []) as Array<{ id: string; full_name: string | null; role: string }>)
    .filter((p) => p.full_name?.trim())
    .map((p) => ({
      value: p.id,
      label: p.role === "task_creator" ? `${p.full_name} (F&B)` : (p.full_name as string),
    }));
}

// The "by" query param, only when it is a real uuid.
export const creatorParam = (v: string | undefined): string | null =>
  isUuid(v) ? v : null;

// Lodge from a ?lodge= id or slug. Unlike resolveLodge there is NO fallback to
// the first lodge: no / unknown value means "All lodges".
export function findLodge(v: string | undefined, lodges: LodgeLite[]): string | null {
  if (!v) return null;
  return (lodges.find((l) => l.id === v) ?? lodges.find((l) => lodgeSlug(l.name) === v))?.id ?? null;
}

export const lodgeOptions = (lodges: LodgeLite[]): FilterOption[] =>
  lodges.map((l) => ({ value: lodgeSlug(l.name), label: l.name }));

// Fetch trips (optionally for one lodge / one creator), newest first, each with
// task counts. RLS scopes what the caller can see. `limit` caps the count.
export async function fetchTripsWithCounts(
  s: SupabaseClient,
  opts: { lodgeId?: string | null; createdBy?: string | null; limit?: number } = {}
): Promise<TripWithCounts[]> {
  let q = s
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });
  if (opts.lodgeId) q = q.eq("lodge_id", opts.lodgeId);
  if (opts.createdBy) q = q.eq("created_by", opts.createdBy);
  if (opts.limit) q = q.limit(opts.limit);
  const { data: trips } = await q;
  const tripRows = (trips ?? []) as Trip[];
  if (tripRows.length === 0) return [];

  // Task counts per trip, in one query.
  const tripIds = tripRows.map((t) => t.id);
  const lodgeIds = Array.from(new Set(tripRows.map((t) => t.lodge_id)));
  // Task counts, lodge names and creator names are independent: load together.
  const [{ data: tasks }, { data: lodges }, creators] = await Promise.all([
    s.from("tasks").select("trip_id,status").in("trip_id", tripIds),
    s.from("lodges").select("id,name").in("id", lodgeIds),
    profileNames(tripRows.map((t) => t.created_by)),
  ]);
  const counts = new Map<string, Record<TaskStatus, number> & { total: number }>();
  for (const id of tripIds) {
    counts.set(id, { total: 0, pending: 0, submitted: 0, resolved: 0, declined: 0 });
  }
  for (const row of (tasks ?? []) as Array<{ trip_id: string; status: TaskStatus }>) {
    const c = counts.get(row.trip_id);
    if (!c) continue;
    c.total += 1;
    if (row.status in c) c[row.status] += 1;
  }

  // Lodge names (service-safe fields only).
  const lodgeName = new Map(
    ((lodges ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name])
  );

  return tripRows.map((t) => {
    const c = counts.get(t.id)!;
    const creator = t.created_by ? creators.get(t.created_by) ?? null : null;
    return {
      ...t,
      lodge_name: lodgeName.get(t.lodge_id) ?? "Lodge",
      authority_name: t.authority?.trim() || creator || "Management",
      creator_name: creator,
      total: c.total,
      pending: c.pending,
      submitted: c.submitted,
      resolved: c.resolved,
      declined: c.declined,
    };
  });
}
