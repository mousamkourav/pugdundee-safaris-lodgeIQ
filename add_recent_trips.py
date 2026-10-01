f = r"app/(dashboard)/trip-reports/page.tsx"
t = open(f, encoding="utf-8").read()

t = t.replace(
    'import { AssignTaskDrawer } from "./assign-task-drawer";',
    'import { fetchTripsWithCounts } from "./trips-data";\nimport { tripDateRange } from "@/lib/tasks";\nimport { AssignTaskDrawer } from "./assign-task-drawer";'
)

t = t.replace(
    "  const all = (data ?? []) as Task[];",
    "  const all = (data ?? []) as Task[];\n\n  const recentTrips = await fetchTripsWithCounts(s, { lodgeId: lodge, limit: 5 });"
)

trips_section = '''      <LodgePicker lodges={lodges} lodge={lodge} />

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
'''
t = t.replace('      <LodgePicker lodges={lodges} lodge={lodge} />\n', trips_section, 1)

open(f, "w", encoding="utf-8").write(t)
print("import ok:", "fetchTripsWithCounts" in t)
print("fetch ok:", "recentTrips = await fetchTripsWithCounts" in t)
print("section ok:", "Recent inspection trips" in t)
