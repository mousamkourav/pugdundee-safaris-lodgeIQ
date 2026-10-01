import Link from "next/link";
import { requireUser, isAdmin } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { Icon } from "@/components/icons";
import {
  canAssignTasks,
  canDeleteTasks,
  canReviewTask,
  canSubmitTask,
  photoList,
  photoUrl,
  tripDateRange,
  type Task,
} from "@/lib/tasks";
import { fetchTripsWithCounts } from "./trips-data";
import { AssignTaskDrawer } from "./assign-task-drawer";
import { TaskCard } from "./task-card";

const TITLE = "Trip reports";
const RECENT_TRIPS = 5;
const RECENT_TASKS = 10;

export default async function TripReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string }>;
}) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  if (lodges.length === 0) return <NoLodge title={TITLE} />;

  const role = profile?.role as string | undefined;
  const admin = isAdmin(role);
  const canAssign = canAssignTasks(role);
  const canDelete = canDeleteTasks(role);

  // Default view: admins see ALL accessible lodges; a lodge can be chosen to
  // narrow. Managers are scoped to their lodge(s) by RLS anyway; if they have a
  // single lodge we still show "all" (which is just theirs).
  const selectedLodge = sp.lodge ? resolveLodge(sp.lodge, lodges) : null;
  const lodgeFilter = selectedLodge ?? null; // null = all accessible lodges
  const selectedName = selectedLodge
    ? lodges.find((l) => l.id === selectedLodge)?.name ?? null
    : null;

  const s = await createClient();

  // Recent trips (optionally filtered to one lodge), newest first.
  const recentTrips = await fetchTripsWithCounts(s, {
    lodgeId: lodgeFilter,
    limit: RECENT_TRIPS,
  });

  // Recent tasks, newest first, across all accessible lodges (RLS scopes).
  let taskQuery = s
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(RECENT_TASKS);
  if (lodgeFilter) taskQuery = taskQuery.eq("lodge_id", lodgeFilter);
  const { data: taskData } = await taskQuery;
  const tasks = (taskData ?? []) as Task[];

  // Resolve names (service role: managers cannot read other profiles).
  const ids = Array.from(
    new Set(
      tasks
        .flatMap((t) => [t.created_by, t.submitted_by, t.resolved_by])
        .filter((v): v is string => !!v)
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

  // Lodge names for task cards (across all lodges view).
  const lodgeNameById = new Map(lodges.map((l) => [l.id, l.name]));

  const allTripsHref = selectedLodge
    ? `/trip-reports/trips?lodge=${encodeURIComponent(lodgeSlug(selectedName ?? ""))}`
    : "/trip-reports/trips";

  return (
    <div>
      <PageHeader
        eyebrow={<span>Field operations registry</span>}
        title="Trip reports & tasks"
        description="Inspection trips and the tasks assigned during them, across all lodges."
        action={canAssign ? <AssignTaskDrawer lodges={lodges} defaultLodge={lodges[0].id} /> : undefined}
      />

      {/* Optional lodge filter (admins). Managers are scoped by RLS. */}
      {admin && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm text-sand-500">Filter:</span>
          <LodgePicker lodges={lodges} lodge={selectedLodge ?? ""} />
          {selectedLodge && (
            <Link href="/trip-reports" className="text-sm font-medium text-olive-700 hover:underline">
              Clear (all lodges)
            </Link>
          )}
        </div>
      )}

      {/* Recent trips */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-6 w-1.5 rounded-full bg-olive-600" />
            <h2 className="text-lg font-semibold text-olive-800">Recent inspection trips</h2>
          </div>
          <Link href={allTripsHref} className="inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:text-olive-800">
            View all trips
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
        {recentTrips.length === 0 ? (
          <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-sand-500">
            No inspection trips logged yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentTrips.map((tr) => (
              <Link
                key={tr.id}
                href={`/trip-reports/trips/${tr.id}`}
                className="flex flex-col gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-card transition hover:shadow-card-hover md:flex-row md:items-center md:justify-between"
              >
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
        )}
      </section>

      {/* Recent tasks */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-6 w-1.5 rounded-full bg-olive-600" />
            <h2 className="text-lg font-semibold text-olive-800">Recent tasks</h2>
          </div>
          <Link href="/trip-reports/tasks" className="inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:text-olive-800">
            View all tasks
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-sand-500">
            No tasks yet.
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
                  lodgeName={lodgeNameById.get(t.lodge_id)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
