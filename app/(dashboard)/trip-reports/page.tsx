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
import { fetchTripsWithCounts } from "./trips-data";
import { tripDateRange } from "@/lib/tasks";
import { AssignTaskDrawer } from "./assign-task-drawer";
import { CompleteTaskForm } from "./complete-task-form";
import { ReviewButtons } from "./review-buttons";
import { TaskCard } from "./task-card";

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

  const recentTrips = await fetchTripsWithCounts(s, { lodgeId: lodge, limit: 5 });

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

      {recentTrips.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-6 w-1.5 rounded-full bg-olive-600" />
              <h2 className="text-lg font-semibold text-olive-800">Recent inspection trips</h2>
            </div>
            <Link href={`/trip-reports/trips?lodge=${encodeURIComponent(slug)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:text-olive-800">
              View all trips
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {recentTrips.map((tr) => (
              <Link key={tr.id} href={`/trip-reports/trips/${tr.id}`} className="flex flex-col gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-card transition hover:shadow-card-hover md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-[150px]">
                    <p className="truncate font-semibold text-sand-900">{tr.authority_name}</p>
                    <p className="text-xs text-sand-500">Inspection lead</p>
                  </div>
                  <div className="space-y-0.5 text-sm">
                    <p className="flex items-center gap-1.5 font-medium text-sand-800">
                      <Icon name="mapPin" className="h-4 w-4 text-olive-700" />
                      {tr.lodge_name}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-sand-500">
                      <Icon name="calendar" className="h-3.5 w-3.5" />
                      {tripDateRange(tr.start_date, tr.end_date)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 border-t border-sand-100 pt-2 text-xs md:border-t-0 md:pt-0">
                  <span className="rounded-md bg-sand-100 px-2 py-1 font-semibold text-sand-700">{tr.total} assigned</span>
                  <span className="rounded-md bg-success-bg px-2 py-1 font-semibold text-success">{tr.resolved} resolved</span>
                  <span className="rounded-md bg-pending-bg px-2 py-1 font-semibold text-warning">{tr.pending} pending</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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
        <div className="flex flex-col gap-2">
          {tasks.map((t) => {
            const refUrls = photoList(t.assigned_photos).map((p) => photoUrl(s, p));
            const doneUrls = photoList(t.completion_photos).map((p) => photoUrl(s, p));
            return (
              <TaskCard
                key={t.id}
                task={t}
                refUrls={refUrls}
                doneUrls={doneUrls}
                assignedByName={who(t.created_by)}
                submittedByName={who(t.submitted_by)}
                resolvedByName={who(t.resolved_by)}
                canSubmit={canSubmitTask(t)}
                canReview={canReviewTask(t, user.id)}
                canDelete={canDelete}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
