import Link from "next/link";
import { requireUser, isAdmin } from "@/lib/auth";
import { getAccessibleLodges } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Icon } from "@/components/icons";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  STATUS_LABEL,
  PRIORITY_LABEL,
  canDeleteTasks,
  canReviewTask,
  canSubmitTask,
  isTaskStatus,
  isTaskPriority,
  photoList,
  photoUrl,
  type Task,
} from "@/lib/tasks";
import { TaskCard } from "../task-card";

type SP = { status?: string; priority?: string; lodge?: string; q?: string };

export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const { user, profile } = await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const role = profile?.role as string | undefined;
  const admin = isAdmin(role);
  const canDelete = canDeleteTasks(role);

  const fStatus = isTaskStatus(sp.status) ? sp.status : null;
  const fPriority = isTaskPriority(sp.priority) ? sp.priority : null;
  const fLodge = sp.lodge && lodges.some((l) => l.id === sp.lodge) ? sp.lodge : null;

  const s = await createClient();
  let q = s.from("tasks").select("*").order("created_at", { ascending: false }).limit(500);
  if (fStatus) q = q.eq("status", fStatus);
  if (fPriority) q = q.eq("priority", fPriority);
  if (fLodge) q = q.eq("lodge_id", fLodge);
  const { data } = await q;
  const tasks = (data ?? []) as Task[];

  const ids = Array.from(new Set(tasks.flatMap((t) => [t.created_by, t.submitted_by, t.resolved_by]).filter((v): v is string => !!v)));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await createAdminClient().from("profiles").select("id,full_name").in("id", ids);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name ?? "Unknown");
  }
  const who = (id: string | null) => (id ? names.get(id) ?? "Unknown" : "-");
  const lodgeNameById = new Map(lodges.map((l) => [l.id, l.name]));

  const qs = (patch: Partial<SP>) => {
    const params = new URLSearchParams();
    const merged: SP = { status: fStatus ?? undefined, priority: fPriority ?? undefined, lodge: fLodge ?? undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const str = params.toString();
    return "/trip-reports/tasks" + (str ? "?" + str : "");
  };

  const chip = (active: boolean) =>
    "rounded-full border px-3 py-1 text-sm font-medium transition " +
    (active ? "border-olive-600 bg-olive-50 text-olive-800" : "border-sand-200 bg-white text-sand-600 hover:bg-sand-50");

  const anyFilter = fStatus || fPriority || fLodge;

  return (
    <div>
      <Link href="/trip-reports" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:underline">
        <Icon name="chevronLeft" className="h-4 w-4" />
        Back to trip reports
      </Link>
      <PageHeader eyebrow={<span>All tasks</span>} title="Task directory" description="Every task across lodges. Filter by status, priority or lodge." />

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
                  <Link key={l.id} href={qs({ lodge: l.id })} className={chip(fLodge === l.id)}>{l.name}</Link>
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
                    lodgeName={lodgeNameById.get(t.lodge_id)}
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
