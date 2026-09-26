import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  TASK_STATUSES,
  canAssignTasks,
  canDeleteTasks,
  canReviewTask,
  canSubmitTask,
  formatDate,
  isTaskStatus,
  photoList,
  photoUrl,
  type Task,
  type TaskStatus,
} from "@/lib/tasks";
import { AssignTaskForm } from "./assign-task-form";
import { CompleteTaskForm } from "./complete-task-form";
import { ReviewButtons } from "./review-buttons";

const TITLE = "Trip reports";

const EMPTY: Record<TaskStatus, string> = {
  pending: "No open tasks for this lodge.",
  submitted: "Nothing waiting for review.",
  resolved: "No resolved tasks yet.",
  declined: "No declined tasks.",
};

function Photos({ label, urls }: { label: string; urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sand-500">
        {label}
      </p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {urls.map((u) => (
          <a
            key={u}
            href={u}
            target="_blank"
            rel="noopener noreferrer"
            className="block aspect-square overflow-hidden rounded-lg border border-sand-200 bg-sand-100"
          >
            <img
              src={u}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition hover:opacity-90"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

export default async function TripReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; tab?: string }>;
}) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  if (!lodge) return <NoLodge title={TITLE} />;

  const tab: TaskStatus = isTaskStatus(sp.tab) ? sp.tab : "pending";
  const role = profile?.role as string | undefined;
  const canAssign = canAssignTasks(role);
  const canDelete = canDeleteTasks(role);
  const slug = lodgeSlug(lodges.find((l) => l.id === lodge)?.name ?? lodge);

  const s = await createClient();
  const { data } = await s
    .from("tasks")
    .select("*")
    .eq("lodge_id", lodge)
    .order("created_at", { ascending: false })
    .limit(500);
  const all = (data ?? []) as Task[];

  const counts = Object.fromEntries(TASK_STATUSES.map((t) => [t, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const t of all) if (isTaskStatus(t.status)) counts[t.status] += 1;
  const tasks = all.filter((t) => t.status === tab);

  // Names for "assigned by / submitted by". Managers cannot read other
  // profiles under RLS, so read just id + full_name with the service role.
  const ids = Array.from(
    new Set(
      tasks.flatMap((t) => [t.created_by, t.submitted_by, t.resolved_by]).filter(
        (v): v is string => !!v
      )
    )
  );
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await createAdminClient()
      .from("profiles")
      .select("id,full_name")
      .in("id", ids);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) {
      names.set(p.id, p.full_name ?? "Unknown");
    }
  }
  const who = (id: string | null) => (id ? names.get(id) ?? "Unknown" : "-");

  return (
    <div>
      <PageHeader
        title={TITLE}
        description="Tasks raised on lodge visits. Managers complete them with photos; the person who assigned them approves or declines."
      />
      <LodgePicker lodges={lodges} lodge={lodge} />

      {canAssign && (
        <details className="group mb-6 rounded-xl border border-sand-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-olive-700">
            Assign a new task
            <span className="text-sand-400 transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-sand-200 p-4">
            <AssignTaskForm lodges={lodges} defaultLodge={lodge} />
          </div>
        </details>
      )}

      <nav className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-sand-200">
          {TASK_STATUSES.map((t) => {
            const active = t === tab;
            return (
              <Link
                key={t}
                href={`/trip-reports?lodge=${encodeURIComponent(slug)}&tab=${t}`}
                className={
                  "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm " +
                  (active
                    ? "border-olive-600 font-medium text-olive-700"
                    : "border-transparent text-sand-600 hover:text-sand-800")
                }
              >
                {STATUS_LABEL[t]}
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-xs tabular " +
                    (active ? STATUS_BADGE[t] : "bg-sand-100 text-sand-600")
                  }
                >
                  {counts[t]}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sand-500">
          {EMPTY[tab]}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tasks.map((t) => {
            const refs = photoList(t.assigned_photos).map((p) => photoUrl(s, p));
            const doneUrls = photoList(t.completion_photos).map((p) => photoUrl(s, p));
            const overdue =
              t.due_date &&
              (t.status === "pending" || t.status === "declined") &&
              t.due_date < new Date().toISOString().slice(0, 10);
            const review = canReviewTask(t, user.id);
            return (
              <article
                key={t.id}
                className="flex min-w-0 flex-col gap-4 rounded-xl border border-sand-200 bg-white p-4"
              >
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.medium}`}
                    >
                      {PRIORITY_LABEL[t.priority] ?? t.priority} priority
                    </span>
                    {t.due_date && (
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-xs " +
                          (overdue ? "bg-error-bg text-error" : "bg-sand-100 text-sand-600")
                        }
                      >
                        {overdue ? "Overdue: " : "Due "}
                        {formatDate(t.due_date)}
                      </span>
                    )}
                  </div>
                  <h2 className="break-words text-lg text-sand-900">{t.title}</h2>
                  {t.description && (
                    <p className="mt-1 whitespace-pre-line break-words text-sm text-sand-700">
                      {t.description}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-sand-500">
                    Assigned by {who(t.created_by)} on {formatDate(t.created_at)}
                  </p>
                </div>

                <Photos label="Reference" urls={refs} />

                {t.status === "declined" && t.decline_reason && (
                  <div className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
                    <span className="font-medium">Declined:</span> {t.decline_reason}
                    {t.resolved_by && (
                      <span className="block text-xs opacity-80">
                        by {who(t.resolved_by)} on {formatDate(t.resolved_at)}
                      </span>
                    )}
                  </div>
                )}

                {t.submitted_at && t.status !== "pending" && (
                  <div className="space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-3">
                    <p className="text-xs text-sand-500">
                      {t.status === "declined" ? "Last submitted" : "Completed"} by{" "}
                      {who(t.submitted_by)} on {formatDate(t.submitted_at)}
                    </p>
                    {t.completion_comment && (
                      <p className="whitespace-pre-line break-words text-sm text-sand-700">
                        {t.completion_comment}
                      </p>
                    )}
                    <Photos label="Completion" urls={doneUrls} />
                  </div>
                )}

                {t.status === "resolved" && (
                  <p className="text-xs text-success">
                    Approved by {who(t.resolved_by)} on {formatDate(t.resolved_at)}
                  </p>
                )}

                {t.status === "submitted" && !review && (
                  <p className="text-xs text-sand-500">
                    Waiting for {who(t.created_by)} to review.
                  </p>
                )}

                {(canSubmitTask(t) || review || canDelete) && (
                  <div className="mt-auto space-y-3 border-t border-sand-100 pt-3">
                    {canSubmitTask(t) && (
                      <CompleteTaskForm
                        taskId={t.id}
                        lodgeId={t.lodge_id}
                        resubmit={t.status === "declined"}
                      />
                    )}
                    <ReviewButtons taskId={t.id} canReview={review} canDelete={canDelete} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
