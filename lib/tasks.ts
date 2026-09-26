// Trip reports / task tracking: shared types, badge styles, path helpers and
// permission rules. Safe to import from both server and client code.

import type { SupabaseClient } from "@supabase/supabase-js";

// Same set as SUPER_ROLES in lib/auth.ts. Duplicated because lib/auth.ts pulls
// in server-only code and this file is also imported by client components.
const TASK_ADMIN_ROLES = ["super_admin", "senior_manager"];
const isSuperAdmin = (role?: string | null) =>
  !!role && TASK_ADMIN_ROLES.includes(role);

// Roles that receive "new task" notifications for their assigned lodges.
export const TASK_MANAGER_ROLES = [
  "lodge_manager",
  "operations_manager",
  "lodge_accounts",
];

export const TASK_BUCKET = "task-photos";
export const MAX_PHOTOS = 6;

export type TaskStatus = "pending" | "submitted" | "resolved" | "declined";
export type TaskPriority = "low" | "medium" | "high";
export type PhotoKind = "ref" | "done";

export const TASK_STATUSES: TaskStatus[] = [
  "pending",
  "submitted",
  "resolved",
  "declined",
];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

export type Task = {
  id: string;
  lodge_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  due_date: string | null;
  status: TaskStatus;
  assigned_photos: string[] | null;
  completion_photos: string[] | null;
  completion_comment: string | null;
  decline_reason: string | null;
  created_by: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  submitted: "Submitted",
  resolved: "Resolved",
  declined: "Declined",
};

export const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: "border border-pending-border bg-pending-bg text-warning",
  submitted: "border border-info-border bg-info-bg text-info",
  resolved: "border border-success-border bg-success-bg text-success",
  declined: "border border-error-border bg-error-bg text-error",
};

// Solid accent per status: card left edge and the 6px status dot.
export const STATUS_ACCENT: Record<TaskStatus, { bar: string; dot: string }> = {
  pending: { bar: "border-l-pending", dot: "bg-pending" },
  submitted: { bar: "border-l-info", dot: "bg-info" },
  resolved: { bar: "border-l-success", dot: "bg-success" },
  declined: { bar: "border-l-error", dot: "bg-error" },
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: "border border-sand-200 bg-sand-100 text-sand-600",
  medium: "border border-gold-200 bg-gold-50 text-gold-800",
  high: "border border-error-border bg-error-bg text-error",
};

export const isTaskStatus = (v: unknown): v is TaskStatus =>
  typeof v === "string" && (TASK_STATUSES as string[]).includes(v);

export const isTaskPriority = (v: unknown): v is TaskPriority =>
  typeof v === "string" && (TASK_PRIORITIES as string[]).includes(v);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

// crypto.randomUUID only exists in secure contexts (https / localhost). Fall
// back to getRandomValues so a phone testing over plain LAN http still works.
export function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Storage layout: {lodge_id}/{task_id}/{ref|done}/{uuid}.jpg
export const taskFolder = (lodgeId: string, taskId: string) =>
  `${lodgeId}/${taskId}`;

export const photoPath = (
  lodgeId: string,
  taskId: string,
  kind: PhotoKind,
  id: string = newUuid()
) => `${taskFolder(lodgeId, taskId)}/${kind}/${id}.jpg`;

// True only for a path this app would have generated for this task + kind.
export function isValidPhotoPath(
  path: unknown,
  lodgeId: string,
  taskId: string,
  kind: PhotoKind
): path is string {
  if (typeof path !== "string") return false;
  const prefix = `${taskFolder(lodgeId, taskId)}/${kind}/`;
  if (!path.startsWith(prefix)) return false;
  const file = path.slice(prefix.length);
  return /^[0-9a-f-]{36}\.jpg$/i.test(file) && isUuid(file.slice(0, 36));
}

// Normalise a jsonb photo column into a clean string[].
export function photoList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
}

// Public bucket, so a plain public URL is enough (resolved at render time).
export function photoUrl(client: SupabaseClient, path: string): string {
  return client.storage.from(TASK_BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---- Permission rules (mirrored server-side in every action) ----

export const canAssignTasks = (role?: string | null) => isSuperAdmin(role);
export const canDeleteTasks = (role?: string | null) => isSuperAdmin(role);

// Anyone who can see the task (RLS = lodge access) may submit completion
// while it is still open or after it was declined.
export const canSubmitTask = (task: Pick<Task, "status">) =>
  task.status === "pending" || task.status === "declined";

// Only the person who assigned the task reviews it.
export const canReviewTask = (
  task: Pick<Task, "status" | "created_by">,
  userId: string | null | undefined
) => !!userId && task.created_by === userId && task.status === "submitted";

// ---- Browser upload helper ----

// Uploads blobs to the given task folder. On any failure it removes whatever
// it already uploaded and throws, so the caller never leaks half a set.
export async function uploadTaskPhotos(
  client: SupabaseClient,
  lodgeId: string,
  taskId: string,
  kind: PhotoKind,
  blobs: Blob[]
): Promise<string[]> {
  const done: string[] = [];
  try {
    for (const blob of blobs) {
      const path = photoPath(lodgeId, taskId, kind);
      const { error } = await client.storage.from(TASK_BUCKET).upload(path, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw new Error(`Photo upload failed: ${error.message}`);
      done.push(path);
    }
    return done;
  } catch (e) {
    await removeTaskPhotos(client, done);
    throw e;
  }
}

export async function removeTaskPhotos(client: SupabaseClient, paths: string[]) {
  if (!paths.length) return;
  try {
    await client.storage.from(TASK_BUCKET).remove(paths);
  } catch {
    // Best effort cleanup; orphaned files are harmless and rare.
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : iso;
}
