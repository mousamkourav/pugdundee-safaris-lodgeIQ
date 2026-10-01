import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { LodgePicker } from "@/components/lodge-picker";
import { Icon } from "@/components/icons";
import { tripDateRange } from "@/lib/tasks";
import { fetchTripsWithCounts } from "../trips-data";

export default async function AllTripsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = sp.lodge ? resolveLodge(sp.lodge, lodges) : null;

  const s = await createClient();
  const trips = await fetchTripsWithCounts(s, { lodgeId: lodge, limit: 200 });

  const creatorIds = Array.from(
    new Set(trips.filter((t) => !t.authority?.trim() && t.created_by).map((t) => t.created_by as string))
  );
  const names = new Map<string, string>();
  if (creatorIds.length) {
    const { data: people } = await createAdminClient().from("profiles").select("id,full_name").in("id", creatorIds);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name ?? "Management");
  }
  const authorityOf = (t: (typeof trips)[number]) =>
    t.authority?.trim() || (t.created_by ? names.get(t.created_by) ?? "Management" : "Management");

  return (
    <div>
      <Link href="/trip-reports" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:underline">
        <Icon name="chevronLeft" className="h-4 w-4" />
        Back to trip reports
      </Link>
      <PageHeader eyebrow={<span>All inspection trips</span>} title="Inspection trips" description="Every logged lodge visit and the tasks assigned during it." />
      <div className="mb-6">
        <LodgePicker lodges={lodges} lodge={lodge ?? ""} />
      </div>
      {trips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center text-sm text-sand-500">No trips recorded yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {trips.map((tr) => (
            <Link key={tr.id} href={`/trip-reports/trips/${tr.id}`} className="flex flex-col gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-card transition hover:shadow-card-hover md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-[150px]">
                  <p className="truncate font-semibold text-sand-900">{authorityOf(tr)}</p>
                  <p className="text-xs text-sand-500">Inspection lead</p>
                </div>
                <div className="space-y-0.5 text-sm">
                  <p className="flex items-center gap-1.5 font-medium text-sand-800"><Icon name="mapPin" className="h-4 w-4 text-olive-700" />{tr.lodge_name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-sand-500"><Icon name="calendar" className="h-3.5 w-3.5" />{tripDateRange(tr.start_date, tr.end_date)}</p>
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
    </div>
  );
}
