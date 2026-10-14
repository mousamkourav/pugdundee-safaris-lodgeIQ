import Link from "next/link";
import { Icon } from "@/components/icons";
import { tripDateRange } from "@/lib/tasks";
import type { TripWithCounts } from "./trips-data";

// One trip in the hub / all-trips lists. The inspection lead is the typed
// authority (else the creator); "Logged by" shows the account that created the
// trip when that differs, so every person's trips stay recognisable.
export function TripRow({ trip: tr }: { trip: TripWithCounts }) {
  const loggedBy =
    tr.creator_name && tr.creator_name !== tr.authority_name ? tr.creator_name : null;
  return (
    <Link
      href={`/trip-reports/trips/${tr.id}`}
      className="flex flex-col gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-card transition hover:shadow-card-hover md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-[150px]">
          <p className="truncate font-semibold text-sand-900">{tr.authority_name}</p>
          <p className="text-xs text-sand-500">
            Inspection lead{loggedBy ? ` - logged by ${loggedBy}` : ""}
          </p>
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
  );
}
