import Link from "next/link";
import { requireUser, isAdmin, isTaskCreatorOnly } from "@/lib/auth";
import { getAccessibleLodges, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Icon } from "@/components/icons";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  STATUS_LABEL,
  PRIORITY_LABEL,
  canDeleteTasks,
  canEditTask,
  canReviewTask,
  canSubmitTask,
  isTaskStatus,
  isTaskPriority,
  lockedDepartmentFor,
  photoList,
  photoUrl,
  type Task,
} from "@/lib/tasks";
import { TaskCard } from "../task-card";
import { assignerOptions, creatorParam, findLodge, profileNames } from "../trips-data";

type SP = { status?: string; priority?: string; lodge?: string; by?: string; q?: string };

export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const [{ user, profile }, sp, lodges] = await Promise.all([
    requireUser(),
    searchParams,
    getAccessibleLodges(),
  ]);
  const role = profile?.role as string | undefined;
  const admin = isAdmin(role);
  const canDelete = canDeleteTasks(role);
  const lockedDept = lockedDepartmentFor(role);

  const fStatus = isTaskStatus(sp.status) ? sp.status : null;
  const fPriority = isTaskPriority(sp.priority) ? sp.priority : null;
  // Lodge accepts a slug (current links) or an id (older links); none = all.
  const fLodge = findLodge(sp.lodge, lodges);
  const fLodgeSlug = fLodge ? lodgeSlug(lodges.find((l) => l.id === fLodge)?.name ?? "") : null;
  const showCreatorFilter = !isTaskCreatorOnly(role);
  const fBy = showCreatorFilter ? creatorParam(sp.by) : null;

  const s = await createClient();
  let q = s.from("tasks").select("*").order("created_at", { ascending: false }).limit(500);
  if (fStatus) q = q.eq("status", fStatus);
  if (fPriority) q = q.eq("priority", fPriority);
  if (fLodge) q = q.eq("lodge_id", fLodge);
  if (fBy) q = q.eq("created_by", fBy);
  const [{ data }, creators] = await Promise.all([
    q,
    showCreatorFilter ? assignerOptions() : Promise.resolve([]),
  ]);
  const tasks = (data ?? []) as Task[];

  const names = await profileNames(tasks.flatMap((t) => [t.created_by, t.submitted_by, t.resolved_by]));
  const who = (id: string | null) => (id ? names.get(id) ?? "Unknown" : "-");
  const lodgeNameById = new Map(lodges.map((l) => [l.id, l.name]));

  const qs = (patch: Partial<SP>) => {
    const params = new URLSearchParams();
    const merged: SP = { status: fStatus ?? undefined, priority: fPriority ?? undefined, lodge: fLodgeSlug ?? undefined, by: fBy ?? undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const str = params.toString();
    return "/trip-reports/tasks" + (str ? "?" + str : "");
  };

  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1 text-sm font-medium transition " +
    (active ? "border-olive-600 bg-olive-50 text-olive-800" : "border-sand-200 bg-white text-sand-600 hover:bg-sand-50");

  const anyFilter = fStatus || fPriority || fLodge || fBy;

  return (
    <div>
      <Link href="/trip-reports" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:underline">
        <Icon name="chevronLeft" className="h-4 w-4" />
        Back to trip reports
      </Link>
      <PageHeader eyebrow={<span>All tasks</span>} title="Task directory" description="Every task across lodges. Filter by status, priority, lodge or who assigned it." />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-60 lg:shrink-0 space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">Status</p>
            <div className="flex flex-wrap gap-2">
              <Link href={qs({ status: undefined })} className={chip(!fStatus)}>All</Link>
              {TASK_STATUSES.map((st) => (
                <Link key={st} href={qs({ status: st })} className={chip(fStatus === st)}>{STATUS_LABEL[st]}</Link>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">Priority</p>
            <div className="flex flex-wrap gap-2">
              <Link href={qs({ priority: undefined })} className={chip(!fPriority)}>All</Link>
              {TASK_PRIORITIES.map((pr) => (
                <Link key={pr} href={qs({ priority: pr })} className={chip(fPriority === pr)}>{PRIORITY_LABEL[pr]}</Link>
              ))}
            </div>
          </div>
          {admin && lodges.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">Lodge</p>
              <div className="flex flex-wrap gap-2">
                <Link href={qs({ lodge: undefined })} className={chip(!fLodge)}>All</Link>
                {lodges.map((l) => (
                  <Link key={l.id} href={qs({ lodge: lodgeSlug(l.name) })} className={chip(fLodge === l.id)}>{l.name}</Link>
                ))}
              </div>
            </div>
          )}
          {showCreatorFilter && creators.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">Assigned by</p>
              <div className="flex flex-wrap gap-2">
                <Link href={qs({ by: undefined })} className={chip(!fBy)}>All</Link>
                {creators.map((c) => (
                  <Link key={c.value} href={qs({ by: c.value })} className={chip(fBy === c.value)}>{c.label}</Link>
                ))}
              </div>
            </div>
          )}
          {anyFilter && (
            <Link href="/trip-reports/tasks" className="inline-flex items-center gap-1 text-sm font-medium text-olive-700 hover:underline">
              <Icon name="x" className="h-3.5 w-3.5" />
              Clear filters
            </Link>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          <p className="mb-3 text-sm text-sand-500">{tasks.length} task{tasks.length === 1 ? "" : "s"}</p>
          {tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center text-sm text-sand-500">No tasks match these filters.</div>
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
        </div>
      </div>
    </div>
  );
}
