import Link from "next/link";
import { requireUser, isAdmin, isTaskCreatorOnly } from "@/lib/auth";
import { getAccessibleLodges, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { FilterSelect } from "@/components/filter-select";
import { NoLodge } from "@/components/no-lodge";
import { Icon } from "@/components/icons";
import {
  canAssignTasks,
  canDeleteTasks,
  canEditTask,
  canReviewTask,
  canSubmitTask,
  lockedDepartmentFor,
  photoList,
  photoUrl,
  type Task,
} from "@/lib/tasks";
import {
  assignerOptions,
  creatorParam,
  fetchTripsWithCounts,
  findLodge,
  lodgeOptions,
  profileNames,
} from "./trips-data";
import { AssignTaskDrawer } from "./assign-task-drawer";
import { TaskCard } from "./task-card";
import { TripRow } from "./trip-row";

const TITLE = "Trip reports";
const RECENT_TRIPS = 5;
const RECENT_TASKS = 10;

export default async function TripReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; by?: string }>;
}) {
  const [{ user, profile }, sp, lodges] = await Promise.all([
    requireUser(),
    searchParams,
    getAccessibleLodges(),
  ]);
  if (lodges.length === 0) return <NoLodge title={TITLE} />;

  const role = profile?.role as string | undefined;
  const admin = isAdmin(role);
  const canAssign = canAssignTasks(role);
  const canDelete = canDeleteTasks(role);
  const lockedDept = lockedDepartmentFor(role);
  // A task creator only ever sees her own trips/tasks (RLS), so a "created by"
  // filter would be meaningless for her.
  const showCreatorFilter = !isTaskCreatorOnly(role);

  // Default view: ALL accessible lodges and all creators. A lodge / creator is
  // only applied when chosen in the filters (no implicit first-lodge pick).
  // Managers are scoped to their lodge(s) by RLS anyway.
  const lodgeFilter = admin ? findLodge(sp.lodge, lodges) : null;
  const byFilter = showCreatorFilter ? creatorParam(sp.by) : null;
  const lodgeName = lodgeFilter ? lodges.find((l) => l.id === lodgeFilter)?.name ?? null : null;

  const s = await createClient();

  // Recent tasks, newest first, across all accessible lodges (RLS scopes).
  let taskQuery = s
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(RECENT_TASKS);
  if (lodgeFilter) taskQuery = taskQuery.eq("lodge_id", lodgeFilter);
  if (byFilter) taskQuery = taskQuery.eq("created_by", byFilter);
  // Recent trips, recent tasks and the creator options are independent.
  const [recentTrips, { data: taskData }, creators] = await Promise.all([
    fetchTripsWithCounts(s, { lodgeId: lodgeFilter, createdBy: byFilter, limit: RECENT_TRIPS }),
    taskQuery,
    showCreatorFilter ? assignerOptions() : Promise.resolve([]),
  ]);
  const tasks = (taskData ?? []) as Task[];

  // Resolve names (service role: managers cannot read other profiles).
  const names = await profileNames(
    tasks.flatMap((t) => [t.created_by, t.submitted_by, t.resolved_by])
  );
  const who = (id: string | null) => (id ? names.get(id) ?? "Unknown" : "-");

  // Lodge names for task cards (across all lodges view).
  const lodgeNameById = new Map(lodges.map((l) => [l.id, l.name]));

  // "View all" links keep the current filters.
  const filterQs = (() => {
    const p = new URLSearchParams();
    if (lodgeName) p.set("lodge", lodgeSlug(lodgeName));
    if (byFilter) p.set("by", byFilter);
    const str = p.toString();
    return str ? "?" + str : "";
  })();
  const anyFilter = !!(lodgeFilter || byFilter);

  return (
    <div>
      <PageHeader
        eyebrow={<span>Field operations registry</span>}
        title="Trip reports & tasks"
        description="Inspection trips and the tasks assigned during them, across all lodges."
        action={
          canAssign ? (
            <AssignTaskDrawer
              lodges={lodges}
              defaultLodge={lodgeFilter ?? lodges[0].id}
              defaultAuthority={profile?.full_name ?? ""}
              lockedDepartment={lockedDept}
            />
          ) : undefined
        }
      />

      {/* Optional filters. Lodge: admins only (managers are scoped by RLS). */}
      {(admin || showCreatorFilter) && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm text-sand-500">Filter:</span>
          {admin && (
            <FilterSelect
              param="lodge"
              value={lodgeName ? lodgeSlug(lodgeName) : null}
              options={lodgeOptions(lodges)}
              allLabel="All lodges"
              ariaLabel="Filter by lodge"
            />
          )}
          {showCreatorFilter && creators.length > 0 && (
            <FilterSelect
              param="by"
              value={byFilter}
              options={creators}
              allLabel="All inspection leads"
              ariaLabel="Filter by who created the trip or task"
            />
          )}
          {anyFilter && (
            <Link href="/trip-reports" className="text-sm font-medium text-olive-700 hover:underline">
              Clear filters
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
          <Link href={`/trip-reports/trips${filterQs}`} className="inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:text-olive-800">
            View all trips
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
        {recentTrips.length === 0 ? (
          <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-sand-500">
            {anyFilter ? "No inspection trips match these filters." : "No inspection trips logged yet."}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentTrips.map((tr) => (
              <TripRow key={tr.id} trip={tr} />
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
          <Link href={`/trip-reports/tasks${filterQs}`} className="inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:text-olive-800">
            View all tasks
            <Icon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-sand-500">
            {anyFilter ? "No tasks match these filters." : "No tasks yet."}
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
                  canEdit={canEditTask(t, user.id)}
                  lodgeName={lodgeNameById.get(t.lodge_id)}
                  lockedDepartment={lockedDept}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
