import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { Icon } from "@/components/icons";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_ACCENT,
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
import { AssignTaskDrawer } from "./assign-task-drawer";
import { CompleteTaskForm } from "./complete-task-form";
import { ReviewButtons } from "./review-buttons";

const TITLE = "Trip reports";

const EMPTY: Record<TaskStatus, string> = {
  pending: "No open tasks for this lodge.",
  submitted: "Nothing waiting for review.",
  resolved: "No resolved tasks yet.",
  declined: "No declined tasks.",
};

// Summary-card copy and icon tint per status tab.
const TAB_UI: Record<TaskStatus, { sub: string; icon: string; tile: string; num: string }> = {
  pending: { sub: "Awaiting lodge work", icon: "clipboard", tile: "bg-pending-bg text-pending", num: "bg-pending-bg text-warning" },
  submitted: { sub: "Ready for review", icon: "inbox", tile: "bg-info-bg text-info", num: "bg-info-bg text-info" },
  resolved: { sub: "Approved & filed", icon: "checkCircle", tile: "bg-success-bg text-success", num: "bg-success-bg text-success" },
  declined: { sub: "Needs manager rework", icon: "alert", tile: "bg-error-bg text-error", num: "bg-error-bg text-error" },
};

function Photos({
  label,
  urls,
  icon = "camera",
}: {
  label: string;
  urls: string[];
  icon?: string;
}) {
  if (!urls.length) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sand-600">
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label} ({urls.length})
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {urls.map((u) => (
          <a
            key={u}
            href={u}
            target="_blank"
            rel="noopener noreferrer"
            className="group block aspect-[4/3] overflow-hidden rounded-lg border border-sand-200 bg-sand-100"
          >
            <img
              src={u}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
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
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? lodge;
  const slug = lodgeSlug(lodgeName);

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
        eyebrow={
          <>
            <span>Field operations registry</span>
            <span className="rounded-full border border-gold-200 bg-gold-50 px-2 py-0.5 font-semibold normal-case tracking-normal text-gold-800">
              {lodgeName}
            </span>
          </>
        }
        title="Trip reports & tasks"
        description="Tasks raised on lodge visits. Managers complete them with photos; the person who assigned them approves or declines."
        action={canAssign ? <AssignTaskDrawer lodges={lodges} defaultLodge={lodge} /> : undefined}
      />
      <LodgePicker lodges={lodges} lodge={lodge} />

      {/* Status summary cards double as the tabs */}
      <nav aria-label="Task status" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {TASK_STATUSES.map((t) => {
          const active = t === tab;
          const ui = TAB_UI[t];
          return (
            <Link
              key={t}
              href={`/trip-reports?lodge=${encodeURIComponent(slug)}&tab=${t}`}
              aria-current={active ? "page" : undefined}
              className={
                "flex min-w-0 items-center gap-3 rounded-xl border bg-white p-3 transition sm:p-4 " +
                (active
                  ? "border-olive-600 shadow-card-hover ring-2 ring-olive-600/15"
                  : "border-sand-200 shadow-card hover:shadow-card-hover")
              }
            >
              <span className={`hidden h-11 w-11 shrink-0 place-items-center rounded-lg sm:grid ${ui.tile}`}>
                <Icon name={ui.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-olive-800">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_ACCENT[t].dot}`} />
                  {STATUS_LABEL[t]}
                </span>
                <span className="block truncate text-xs text-sand-500">{ui.sub}</span>
              </span>
              <span
                className={`grid h-10 min-w-10 shrink-0 place-items-center rounded-lg px-2 font-display text-xl font-bold tabular ${ui.num}`}
              >
                {counts[t]}
              </span>
            </Link>
          );
        })}
      </nav>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-sand-100 text-sand-500">
            <Icon name={TAB_UI[tab].icon} className="h-6 w-6" />
          </span>
          <p className="text-sm text-sand-500">{EMPTY[tab]}</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {tasks.map((t) => {
            const refs = photoList(t.assigned_photos).map((p) => photoUrl(s, p));
            const doneUrls = photoList(t.completion_photos).map((p) => photoUrl(s, p));
            const overdue =
              t.due_date &&
              (t.status === "pending" || t.status === "declined") &&
              t.due_date < new Date().toISOString().slice(0, 10);
            const review = canReviewTask(t, user.id);
            const accent = STATUS_ACCENT[t.status] ?? STATUS_ACCENT.pending;
            return (
              <article
                key={t.id}
                className={`flex min-w-0 flex-col gap-5 rounded-xl border border-l-4 border-sand-200 bg-white p-5 shadow-card sm:p-6 ${accent.bar}`}
              >
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.medium}`}
                    >
                      {t.priority === "high" && "! "}
                      {PRIORITY_LABEL[t.priority] ?? t.priority} priority
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[t.status]}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden="true" />
                      {STATUS_LABEL[t.status]}
                    </span>
                    {t.due_date && (
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium sm:ml-auto " +
                          (overdue ? "bg-error-bg text-error" : "bg-sand-100 text-sand-600")
                        }
                      >
                        <Icon name={overdue ? "alert" : "clock"} className="h-3.5 w-3.5" />
                        {overdue ? "Overdue: " : "Due "}
                        {formatDate(t.due_date)}
                      </span>
                    )}
                  </div>
                  <h2 className="break-words text-lg leading-snug sm:text-xl">{t.title}</h2>
                  {t.description && (
                    <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-6 text-sand-700">
                      {t.description}
                    </p>
                  )}
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-sand-500">
                    <Icon name="user" className="h-3.5 w-3.5" />
                    Assigned by <span className="font-semibold text-olive-800">{who(t.created_by)}</span>
                    on {formatDate(t.created_at)}
                  </p>
                </div>

                {refs.length > 0 && (
                  <div className="rounded-xl border border-sand-200 bg-sand-50 p-3">
                    <Photos label="Reference photos" urls={refs} />
                  </div>
                )}

                {t.status === "declined" && t.decline_reason && (
                  <div className="rounded-xl border border-error-border bg-error-bg p-4">
                    <p className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-error">
                      <span className="flex items-center gap-1.5">
                        <Icon name="xCircle" className="h-4 w-4" />
                        Declined{t.resolved_by ? ` by ${who(t.resolved_by)}` : ""}
                      </span>
                      {t.resolved_at && (
                        <span className="font-semibold normal-case tracking-normal">
                          {formatDate(t.resolved_at)}
                        </span>
                      )}
                    </p>
                    <p className="whitespace-pre-line break-words text-sm leading-6 text-error">
                      {t.decline_reason}
                    </p>
                  </div>
                )}

                {t.submitted_at && t.status !== "pending" && (
                  <div className="space-y-3 rounded-xl border border-info-border bg-info-bg/60 p-4">
                    <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-info">
                      <span className="flex items-center gap-1.5">
                        <Icon name="send" className="h-3.5 w-3.5" />
                        {t.status === "declined" ? "Last submission" : "Manager submission report"}
                      </span>
                      <span className="font-semibold normal-case tracking-normal">
                        {who(t.submitted_by)} - {formatDate(t.submitted_at)}
                      </span>
                    </p>
                    {t.completion_comment && (
                      <p className="whitespace-pre-line break-words text-sm italic leading-6 text-sand-700">
                        &quot;{t.completion_comment}&quot;
                      </p>
                    )}
                    <Photos label="Proof photos" urls={doneUrls} icon="checkCircle" />
                  </div>
                )}

                {t.status === "resolved" && (
                  <p className="flex items-center gap-1.5 rounded-lg border border-success-border bg-success-bg px-3 py-2 text-sm font-medium text-success">
                    <Icon name="checkCircle" className="h-4 w-4" />
                    Approved by {who(t.resolved_by)} on {formatDate(t.resolved_at)}
                  </p>
                )}

                {t.status === "submitted" && !review && (
                  <p className="flex items-center gap-1.5 text-xs text-sand-500">
                    <Icon name="clock" className="h-3.5 w-3.5" />
                    Waiting for {who(t.created_by)} to review.
                  </p>
                )}

                {(canSubmitTask(t) || review || canDelete) && (
                  <div className="mt-auto space-y-3 border-t border-sand-100 pt-4">
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
