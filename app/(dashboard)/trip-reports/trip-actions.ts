"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_PHOTOS,
  TASK_MANAGER_ROLES,
  isTaskPriority,
  isUuid,
  isValidPhotoPath,
  type ActionResult,
  type NewTaskInput,
} from "@/lib/tasks";

// Trip = one authority visit to one lodge over a date range, holding many tasks.
// createTrip inserts the trip header, then all its tasks (each linked by
// trip_id and inheriting the trip's lodge), then notifies the lodge managers
// once with a summary. Only super_admin / senior_manager may create trips.

const fail = (error: string): ActionResult => ({ ok: false, error });

function done(): ActionResult {
  revalidatePath("/trip-reports");
  revalidatePath("/notifications");
  return { ok: true };
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate one queued task against the trip's lodge. Returns a clean row (minus
// lodge/trip, which the caller adds) or an error string.
function validateTask(
  t: NewTaskInput,
  lodgeId: string
):
  | string
  | {
      id: string;
      title: string;
      description: string | null;
      priority: string;
      due_date: string | null;
      assigned_photos: string[];
    } {
  if (!isUuid(t?.id)) return "A task has an invalid id.";
  const title = cleanText(t.title, 200);
  if (!title) return "Every task needs a title.";
  if (!isTaskPriority(t.priority)) return `Choose a priority for "${title}".`;
  const due = cleanText(t.due_date, 10);
  if (due && !DATE_RE.test(due)) return `Invalid due date for "${title}".`;

  const photos = Array.isArray(t.photos) ? t.photos : [];
  if (photos.length > MAX_PHOTOS)
    return `"${title}" has too many photos (max ${MAX_PHOTOS}).`;
  if (!photos.every((p) => isValidPhotoPath(p, lodgeId, t.id, "ref")))
    return `"${title}" has a photo in an invalid location.`;

  return {
    id: t.id,
    title,
    description: cleanText(t.description, 4000) || null,
    priority: t.priority,
    due_date: due || null,
    assigned_photos: Array.from(new Set(photos)),
  };
}

async function lodgeName(lodgeId: string): Promise<string> {
  const s = await createClient();
  const { data } = await s
    .from("lodges")
    .select("name")
    .eq("id", lodgeId)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? "your lodge";
}

// Active manager-role users assigned to this lodge.
async function lodgeManagers(lodgeId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: access } = await admin
    .from("user_lodge_access")
    .select("user_id")
    .eq("lodge_id", lodgeId);
  const ids = Array.from(
    new Set(((access ?? []) as Array<{ user_id: string }>).map((a) => a.user_id))
  );
  if (!ids.length) return [];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .in("id", ids)
    .in("role", TASK_MANAGER_ROLES)
    .eq("status", "active");
  return ((profiles ?? []) as Array<{ id: string }>).map((p) => p.id);
}

async function notifyManagers(
  lodgeId: string,
  tripId: string,
  title: string,
  body: string,
  severity: "info" | "warning"
) {
  const targets = await lodgeManagers(lodgeId);
  if (!targets.length) return;
  try {
    const admin = createAdminClient();
    await admin.from("notifications").insert(
      targets.map((target_user) => ({
        type: "trip_assigned",
        severity,
        title,
        body,
        lodge_id: lodgeId,
        target_user,
        status: "pending",
        channels: ["inapp"],
        extra: { trip_id: tripId },
      }))
    );
  } catch (e) {
    console.error("trip notify failed:", e);
  }
}

// ---------------------------------------------------------------------------

// Create a trip and, optionally, its first batch of tasks in one action.
export async function createTrip(input: {
  id: string; // client-generated trip uuid
  lodge_id: string;
  authority?: string;
  focus?: string;
  start_date?: string;
  end_date?: string;
  tasks: NewTaskInput[];
}): Promise<ActionResult> {
  const cu = await getCurrentUser();
  if (!cu?.user) return fail("Please sign in again.");
  if (!isSuperAdmin(cu.profile?.role))
    return fail("Only senior managers can assign trips.");

  const tripId = input?.id;
  const lodgeId = input?.lodge_id;
  if (!isUuid(tripId) || !isUuid(lodgeId)) return fail("Invalid trip or lodge.");

  const start = cleanText(input.start_date, 10);
  const end = cleanText(input.end_date, 10);
  if (start && !DATE_RE.test(start)) return fail("Invalid start date.");
  if (end && !DATE_RE.test(end)) return fail("Invalid end date.");
  if (start && end && end < start)
    return fail("End date cannot be before the start date.");

  const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (rawTasks.length === 0) return fail("Add at least one task to the trip.");

  // Validate every task before writing anything.
  const rows = [];
  for (const t of rawTasks) {
    const v = validateTask(t, lodgeId);
    if (typeof v === "string") return fail(v);
    rows.push(v);
  }

  const s = await createClient();
  const { data: lodge } = await s
    .from("lodges")
    .select("id,name")
    .eq("id", lodgeId)
    .maybeSingle();
  if (!lodge) return fail("Lodge not found.");

  // 1. Insert the trip header.
  const { error: tripErr } = await s.from("trips").insert({
    id: tripId,
    lodge_id: lodgeId,
    authority: cleanText(input.authority, 200) || null,
    focus: cleanText(input.focus, 4000) || null,
    start_date: start || null,
    end_date: end || null,
    status: "active",
    created_by: cu.user.id,
  });
  if (tripErr) {
    return fail(
      tripErr.code === "23505"
        ? "This trip was already saved."
        : `Could not save trip: ${tripErr.message}`
    );
  }

  // 2. Insert all tasks under it.
  const { error: taskErr } = await s.from("tasks").insert(
    rows.map((r) => ({
      id: r.id,
      trip_id: tripId,
      lodge_id: lodgeId,
      title: r.title,
      description: r.description,
      priority: r.priority,
      due_date: r.due_date,
      status: "pending",
      assigned_photos: r.assigned_photos,
      completion_photos: [],
      created_by: cu.user!.id,
    }))
  );
  if (taskErr) {
    // Roll back the trip so we do not leave an empty header.
    await s.from("trips").delete().eq("id", tripId);
    return fail(`Could not save tasks: ${taskErr.message}`);
  }

  const name = (lodge as { name: string }).name;
  const n = rows.length;
  const anyHigh = rows.some((r) => r.priority === "high");
  await notifyManagers(
    lodgeId,
    tripId,
    `${n} new task${n > 1 ? "s" : ""} for ${name}`,
    `${cu.profile?.full_name ?? "Management"} logged a lodge visit and assigned ${n} task${
      n > 1 ? "s" : ""
    }. Open Trip reports to complete them.`,
    anyHigh ? "warning" : "info"
  );

  return done();
}

// Add more tasks to an existing trip (same lodge, inherited from the trip).
export async function addTasksToTrip(input: {
  trip_id: string;
  tasks: NewTaskInput[];
}): Promise<ActionResult> {
  const cu = await getCurrentUser();
  if (!cu?.user) return fail("Please sign in again.");
  if (!isSuperAdmin(cu.profile?.role))
    return fail("Only senior managers can add tasks.");
  if (!isUuid(input?.trip_id)) return fail("Invalid trip.");

  const s = await createClient();
  const { data: trip } = await s
    .from("trips")
    .select("id,lodge_id")
    .eq("id", input.trip_id)
    .maybeSingle();
  if (!trip) return fail("Trip not found or you do not have access to it.");
  const lodgeId = (trip as { lodge_id: string }).lodge_id;

  const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (rawTasks.length === 0) return fail("Add at least one task.");

  const rows = [];
  for (const t of rawTasks) {
    const v = validateTask(t, lodgeId);
    if (typeof v === "string") return fail(v);
    rows.push(v);
  }

  const { error } = await s.from("tasks").insert(
    rows.map((r) => ({
      id: r.id,
      trip_id: input.trip_id,
      lodge_id: lodgeId,
      title: r.title,
      description: r.description,
      priority: r.priority,
      due_date: r.due_date,
      status: "pending",
      assigned_photos: r.assigned_photos,
      completion_photos: [],
      created_by: cu.user!.id,
    }))
  );
  if (error) return fail(`Could not add tasks: ${error.message}`);

  const name = await lodgeName(lodgeId);
  const n = rows.length;
  await notifyManagers(
    lodgeId,
    input.trip_id,
    `${n} more task${n > 1 ? "s" : ""} for ${name}`,
    `${cu.profile?.full_name ?? "Management"} added ${n} task${
      n > 1 ? "s" : ""
    } to an existing lodge visit. Open Trip reports to complete them.`,
    rows.some((r) => r.priority === "high") ? "warning" : "info"
  );

  return done();
}
