import Link from "next/link";
import { requireUser, isTaskCreatorOnly } from "@/lib/auth";
import { getAccessibleLodges, lodgeSlug } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { FilterSelect } from "@/components/filter-select";
import { Icon } from "@/components/icons";
import {
  assignerOptions,
  creatorParam,
  fetchTripsWithCounts,
  findLodge,
  lodgeOptions,
} from "../trips-data";
import { TripRow } from "../trip-row";

export default async function AllTripsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; by?: string }>;
}) {
  const [{ profile }, sp, lodges] = await Promise.all([
    requireUser(),
    searchParams,
    getAccessibleLodges(),
  ]);
  const showCreatorFilter = !isTaskCreatorOnly(profile?.role);
  // No lodge / creator param = all (no implicit first-lodge pick).
  const lodge = findLodge(sp.lodge, lodges);
  const by = showCreatorFilter ? creatorParam(sp.by) : null;
  const lodgeName = lodge ? lodges.find((l) => l.id === lodge)?.name ?? null : null;

  const s = await createClient();
  const [trips, creators] = await Promise.all([
    fetchTripsWithCounts(s, { lodgeId: lodge, createdBy: by, limit: 200 }),
    showCreatorFilter ? assignerOptions() : Promise.resolve([]),
  ]);
  const anyFilter = !!(lodge || by);

  return (
    <div>
      <Link href="/trip-reports" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-olive-700 hover:underline">
        <Icon name="chevronLeft" className="h-4 w-4" />
        Back to trip reports
      </Link>
      <PageHeader eyebrow={<span>All inspection trips</span>} title="Inspection trips" description="Every logged lodge visit and the tasks assigned during it." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {lodges.length > 1 && (
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
            value={by}
            options={creators}
            allLabel="All inspection leads"
            ariaLabel="Filter by who created the trip"
          />
        )}
        {anyFilter && (
          <Link href="/trip-reports/trips" className="text-sm font-medium text-olive-700 hover:underline">
            Clear filters
          </Link>
        )}
      </div>
      {trips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand-300 bg-white p-10 text-center text-sm text-sand-500">
          {anyFilter ? "No trips match these filters." : "No trips recorded yet."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {trips.map((tr) => (
            <TripRow key={tr.id} trip={tr} />
          ))}
        </div>
      )}
    </div>
  );
}
