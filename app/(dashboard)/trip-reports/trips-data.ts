import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trip, TaskStatus } from "@/lib/tasks";

// A trip plus the task counts computed from its tasks.
export type TripWithCounts = Trip & {
  lodge_name: string;
  authority_name: string; // resolved display name (authority text, else creator)
  total: number;
  pending: number;
  submitted: number;
  resolved: number;
  declined: number;
};

// Fetch trips (optionally for one lodge), newest first, each with task counts.
// RLS scopes what the caller can see. `limit` caps the number of trips.
export async function fetchTripsWithCounts(
  s: SupabaseClient,
  opts: { lodgeId?: string | null; limit?: number } = {}
): Promise<TripWithCounts[]> {
  let q = s
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });
  if (opts.lodgeId) q = q.eq("lodge_id", opts.lodgeId);
  if (opts.limit) q = q.limit(opts.limit);
  const { data: trips } = await q;
  const tripRows = (trips ?? []) as Trip[];
  if (tripRows.length === 0) return [];

  // Task counts per trip, in one query.
  const tripIds = tripRows.map((t) => t.id);
  const { data: tasks } = await s
    .from("tasks")
    .select("trip_id,status")
    .in("trip_id", tripIds);
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

  // Lodge names + creator names (service-safe fields only).
  const lodgeIds = Array.from(new Set(tripRows.map((t) => t.lodge_id)));
  const { data: lodges } = await s.from("lodges").select("id,name").in("id", lodgeIds);
  const lodgeName = new Map(
    ((lodges ?? []) as Array<{ id: string; name: string }>).map((l) => [l.id, l.name])
  );

  return tripRows.map((t) => {
    const c = counts.get(t.id)!;
    return {
      ...t,
      lodge_name: lodgeName.get(t.lodge_id) ?? "Lodge",
      authority_name: t.authority?.trim() || "Management",
      total: c.total,
      pending: c.pending,
      submitted: c.submitted,
      resolved: c.resolved,
      declined: c.declined,
    };
  });
}
