import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Icon } from "@/components/icons";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_ACCENT,
  STATUS_BADGE,
  STATUS_LABEL,
  TASK_STATUSES,
  formatDate,
  isTaskStatus,
  photoList,
  photoUrl,
  tripDateRange,
  type Task,
  type TaskStatus,
  type Trip,
} from "@/lib/tasks";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const s = await createClient();

  const { data: tripRow } = await s
    .from("trips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const trip = tripRow as Trip | null;

  if (!trip) {
    return (
      <div>
        <PageHeader title="Trip not found" description="This trip does not exist or you do not have access to it." />
        <Link href="/trip-reports" className="text-sm font-semibold text-olive-700 hover:underline">
          &larr; Back to trip reports
        </Link>
      </div>
    );
  }

  const { data: lodge } = await s.from("lodges").select("name").eq("id", trip.lodge_id).maybeSingle();
  const lodgeName = (lodge as { name: string } | null)?.name ?? "Lodge";

  const { data: taskData } = await s
    .from("tasks")
    .select("*")
    .eq("trip_id", id)
    .order("created_at", { ascending: false });
  const tasks = (taskData ?? []) as Task[];

  const counts = Object.fromEntries(TASK_STATUSES.map((t) => [t, 0])) as Record<TaskStatus, number>;
  for (const t of tasks) if (isTaskStatus(t.status)) counts[t.status] += 1;

  // creator/authority display name
  const nameIds = Array.from(
    new Set(tasks.flatMap((t) => [t.created_by, t.submitted_by, t.resolved_by]).filter((v): v is string => !!v))
  );
  const names = new Map<string, string>();
  if (nameIds.length) {
    const { data: people } = await createAdminClient().from("profiles").select("id,full_name").in("id", nameIds);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name ?? "Unknown");
  }
  const who = (uid: string | null) => (uid ? names.get(uid) ?? "Unknown" : "-");
  const authority = trip.authority?.trim() || who(trip.created_by) || "Management";

  return (
    <div>
      <Link href="/trip-reports" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:underline">
        <Icon name="chevronLeft" className="h-4 w-4" />
        Back to trip reports
      </Link>

      <PageHeader
        eyebrow={<span>Inspection trip</span>}
        title={`${authority} - ${lodgeName}`}
        description={tripDateRange(trip.start_date, trip.end_date)}
      />

      {/* trip summary counts */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
          <p className="text-xs uppercase tracking-wide text-sand-500">Total tasks</p>
          <p className="mt-1 text-2xl font-bold text-sand-900">{tasks.length}</p>
        </div>
        <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
          <p className="text-xs uppercase tracking-wide text-sand-500">Resolved</p>
          <p className="mt-1 text-2xl font-bold text-success">{counts.resolved}</p>
        </div>
        <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
          <p className="text-xs uppercase tracking-wide text-sand-500">Pending</p>
          <p className="mt-1 text-2xl font-bold text-warning">{counts.pending}</p>
        </div>
        <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
          <p className="text-xs uppercase tracking-wide text-sand-500">In review</p>
          <p className="mt-1 text-2xl font-bold text-info">{counts.submitted}</p>
        </div>
      </div>

      {trip.focus && (
        <div className="mb-6 rounded-xl border border-sand-200 bg-sand-50 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sand-500">Inspection focus</p>
          <p className="whitespace-pre-line text-sm text-sand-700">{trip.focus}</p>
        </div>
      )}

      {/* tasks */}
      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center text-sm text-sand-500">
          No tasks recorded for this trip.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tasks.map((t) => {
            const refs = photoList(t.assigned_photos).map((p) => photoUrl(s, p));
            const accent = STATUS_ACCENT[t.status] ?? STATUS_ACCENT.pending;
            return (
              <article key={t.id} className={`flex flex-col gap-3 rounded-xl border border-l-4 border-sand-200 bg-white p-5 shadow-card ${accent.bar}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.medium}`}>
                    {PRIORITY_LABEL[t.priority] ?? t.priority}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[t.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                    {STATUS_LABEL[t.status]}
                  </span>
                  {t.due_date && (
                    <span className="ml-auto text-xs text-sand-500">Due {formatDate(t.due_date)}</span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-sand-900">{t.title}</h3>
                {t.description && <p className="whitespace-pre-line text-sm text-sand-700">{t.description}</p>}
                {refs.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {refs.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] overflow-hidden rounded-lg border border-sand-200 bg-sand-100">
                        <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </a>
                    ))}
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
