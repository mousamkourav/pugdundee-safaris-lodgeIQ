"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_PHOTOS,
  TASK_BUCKET,
  TASK_MANAGER_ROLES,
  canReviewTask,
  canSubmitTask,
  isTaskPriority,
  isUuid,
  isValidPhotoPath,
  photoList,
  taskFolder,
  type ActionResult,
  type PhotoKind,
  type Task,
  type TaskStatus,
} from "@/lib/tasks";

// Every action re-checks permissions here; the UI hiding buttons is not a guard.
// Photos are uploaded by the browser first; actions only receive storage paths
// and reject any path outside {lodge_id}/{task_id}/{kind}/.

const fail = (error: string): ActionResult => ({ ok: false, error });
const STALE =
  "This task was changed by someone else. Refresh the page and try again.";

function done(): ActionResult {
  revalidatePath("/trip-reports");
  revalidatePath("/notifications");
  return { ok: true };
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function checkPhotos(
  paths: unknown,
  lodgeId: string,
  taskId: string,
  kind: PhotoKind,
  min: number
): string[] | string {
  if (!Array.isArray(paths)) return "Invalid photo list.";
  if (paths.length < min) return `Add at least ${min} photo${min > 1 ? "s" : ""}.`;
  if (paths.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} photos are allowed.`;
  if (!paths.every((p) => isValidPhotoPath(p, lodgeId, taskId, kind))) {
    return "One or more photos have an invalid location.";
  }
  return Array.from(new Set(paths as string[]));
}

// Load a task through the user's own session so RLS (has_lodge_access) decides
// visibility. No row back = no access (or it does not exist).
async function loadTask(taskId: string): Promise<Task | null> {
  const s = await createClient();
  const { data } = await s.from("tasks").select("*").eq("id", taskId).maybeSingle();
  return (data as Task | null) ?? null;
}

type NoteInput = {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  lodgeId: string;
  taskId: string;
  targets: string[];
};

// In-app notifications, written with the service role after the caller's
// permission check. A notification failure never fails the action itself.
async function notify(n: NoteInput) {
  const targets = Array.from(new Set(n.targets.filter(Boolean)));
  if (!targets.length) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("notifications").insert(
      targets.map((target_user) => ({
        type: n.type,
        severity: n.severity,
        title: n.title,
        body: n.body,
        lodge_id: n.lodgeId,
        target_user,
        status: "pending",
        channels: ["inapp"],
        extra: { task_id: n.taskId },
      }))
    );
    if (error) console.error("task notify failed:", error.message);
  } catch (e) {
    console.error("task notify failed:", e);
  }
}

// Active manager-role users assigned to this lodge (current role names).
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

async function lodgeName(lodgeId: string): Promise<string> {
  const s = await createClient();
  const { data } = await s.from("lodges").select("name").eq("id", lodgeId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "your lodge";
}

// Storage cleanup uses the service role: the tightened delete policy only lets
// a file's uploader (or an admin) delete, but a resubmission or task delete may
// need to remove files someone else uploaded. Callers check permission first.
async function removeFiles(paths: string[]) {
  if (!paths.length) return;
  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(TASK_BUCKET).remove(paths);
    if (error) console.error("task photo cleanup failed:", error.message);
  } catch (e) {
    console.error("task photo cleanup failed:", e);
  }
}

// ---------------------------------------------------------------------------

export async function createTask(input: {
  id: string;
  lodge_id: string;
  title: string;
  description?: string;
  priority: string;
  due_date?: string;
  photos: string[];
}): Promise<ActionResult> {
  const cu = await getCurrentUser();
  if (!cu?.user) return fail("Please sign in again.");
  if (!isSuperAdmin(cu.profile?.role)) return fail("Only senior managers can assign tasks.");

  const id = input?.id;
  const lodgeId = input?.lodge_id;
  if (!isUuid(id) || !isUuid(lodgeId)) return fail("Invalid task or lodge.");

  const title = cleanText(input.title, 200);
  if (!title) return fail("Title is required.");
  const description = cleanText(input.description, 4000) || null;
  if (!isTaskPriority(input.priority)) return fail("Choose a priority.");
  const due = cleanText(input.due_date, 10);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail("Invalid due date.");

  const photos = checkPhotos(input.photos ?? [], lodgeId, id, "ref", 0);
  if (typeof photos === "string") return fail(photos);

  const s = await createClient();
  const { data: lodge } = await s
    .from("lodges")
    .select("id,name")
    .eq("id", lodgeId)
    .maybeSingle();
  if (!lodge) return fail("Lodge not found.");

  const { error } = await s.from("tasks").insert({
    id,
    lodge_id: lodgeId,
    title,
    description,
    priority: input.priority,
    due_date: due || null,
    status: "pending",
    assigned_photos: photos,
    completion_photos: [],
    created_by: cu.user.id,
  });
  if (error) {
    return fail(
      error.code === "23505" ? "This task was already saved." : `Could not save task: ${error.message}`
    );
  }

  await notify({
    type: "task_assigned",
    severity: input.priority === "high" ? "warning" : "info",
    title: `New task: ${title}`,
    body: `A ${input.priority} priority task was assigned to ${(lodge as { name: string }).name}${
      due ? ` (due ${due})` : ""
    }. Open Trip reports to complete it.`,
    lodgeId,
    taskId: id,
    targets: await lodgeManagers(lodgeId),
  });
  return done();
}

export async function submitCompletion(input: {
  task_id: string;
  photos: string[];
  comment?: string;
}): Promise<ActionResult> {
  const cu = await getCurrentUser();
  if (!cu?.user) return fail("Please sign in again.");
  if (!isUuid(input?.task_id)) return fail("Invalid task.");

  const task = await loadTask(input.task_id);
  if (!task) return fail("Task not found or you do not have access to it.");
  if (!canSubmitTask(task)) return fail(STALE);

  const photos = checkPhotos(input.photos, task.lodge_id, task.id, "done", 1);
  if (typeof photos === "string") return fail(photos);
  const comment = cleanText(input.comment, 4000) || null;

  const s = await createClient();
  const { data, error } = await s
    .from("tasks")
    .update({
      status: "submitted",
      completion_photos: photos,
      completion_comment: comment,
      submitted_by: cu.user.id,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .in("status", [task.status])
    .select("id");
  if (error) return fail(`Could not submit: ${error.message}`);
  if (!data?.length) return fail(STALE);

  // Resubmission after a decline replaces the old completion photos.
  const donePrefix = `${taskFolder(task.lodge_id, task.id)}/done/`;
  await removeFiles(
    photoList(task.completion_photos).filter(
      (p) => p.startsWith(donePrefix) && !photos.includes(p)
    )
  );

  if (task.created_by && task.created_by !== cu.user.id) {
    await notify({
      type: "task_submitted",
      severity: "info",
      title: `Task completed: ${task.title}`,
      body: `${cu.profile?.full_name ?? "A manager"} at ${await lodgeName(
        task.lodge_id
      )} marked this task complete. Review and approve or decline it.`,
      lodgeId: task.lodge_id,
      taskId: task.id,
      targets: [task.created_by],
    });
  }
  return done();
}

async function resolve(
  taskId: unknown,
  outcome: Extract<TaskStatus, "resolved" | "declined">,
  reason?: unknown
): Promise<ActionResult> {
  const cu = await getCurrentUser();
  if (!cu?.user) return fail("Please sign in again.");
  if (!isUuid(taskId)) return fail("Invalid task.");

  const why = cleanText(reason, 2000);
  if (outcome === "declined" && !why) return fail("Enter a reason for declining.");

  const task = await loadTask(taskId);
  if (!task) return fail("Task not found or you do not have access to it.");
  if (task.created_by !== cu.user.id) {
    return fail("Only the person who assigned this task can review it.");
  }
  if (!canReviewTask(task, cu.user.id)) return fail(STALE);

  const s = await createClient();
  const { data, error } = await s
    .from("tasks")
    .update({
      status: outcome,
      resolved_by: cu.user.id,
      resolved_at: new Date().toISOString(),
      ...(outcome === "declined" ? { decline_reason: why } : {}),
    })
    .eq("id", task.id)
    .in("status", ["submitted"])
    .select("id");
  if (error) return fail(`Could not update task: ${error.message}`);
  if (!data?.length) return fail(STALE);

  if (task.submitted_by && task.submitted_by !== cu.user.id) {
    await notify({
      type: outcome === "resolved" ? "task_approved" : "task_declined",
      severity: outcome === "resolved" ? "info" : "warning",
      title:
        outcome === "resolved"
          ? `Task approved: ${task.title}`
          : `Task declined: ${task.title}`,
      body:
        outcome === "resolved"
          ? "Your completion was approved. Thank you!"
          : `Reason: ${why}. Please fix and resubmit from Trip reports.`,
      lodgeId: task.lodge_id,
      taskId: task.id,
      targets: [task.submitted_by],
    });
  }
  return done();
}

export async function approveTask(taskId: string): Promise<ActionResult> {
  return resolve(taskId, "resolved");
}

export async function declineTask(
  taskId: string,
  reason: string
): Promise<ActionResult> {
  return resolve(taskId, "declined", reason);
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const cu = await getCurrentUser();
  if (!cu?.user) return fail("Please sign in again.");
  if (!isSuperAdmin(cu.profile?.role)) return fail("Only senior managers can delete tasks.");
  if (!isUuid(taskId)) return fail("Invalid task.");

  const task = await loadTask(taskId);
  if (!task) return fail("Task not found.");

  const s = await createClient();
  const { data, error } = await s.from("tasks").delete().eq("id", task.id).select("id");
  if (error) return fail(`Could not delete task: ${error.message}`);
  if (!data?.length) return fail("Task could not be deleted.");

  // Remove the whole {lodge_id}/{task_id}/ folder. Storage list() is not
  // recursive, so list each sub-folder and also include the jsonb paths.
  const folder = taskFolder(task.lodge_id, task.id);
  const paths = new Set<string>([
    ...photoList(task.assigned_photos),
    ...photoList(task.completion_photos),
  ]);
  try {
    const admin = createAdminClient();
    for (const sub of ["ref", "done"]) {
      const { data: files } = await admin.storage
        .from(TASK_BUCKET)
        .list(`${folder}/${sub}`, { limit: 1000 });
      for (const f of files ?? []) paths.add(`${folder}/${sub}/${f.name}`);
    }
  } catch (e) {
    console.error("task folder listing failed:", e);
  }
  await removeFiles(Array.from(paths).filter((p) => p.startsWith(`${folder}/`)));
  return done();
}
