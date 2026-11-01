import Link from "next/link";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { loadPricingData } from "@/lib/sales/pricing/load";
import { rateCoverage, seasonMonths, type CoverageArea, type CoverageIssue } from "@/lib/sales/master/coverage";
import { loadMissingTransfers } from "@/lib/sales/master/missing-transfers-data";

// Every price a quote on our circuit can need, priced with the real engine; the gaps listed by
// kind (lib/sales/master/coverage.ts). Transfers: the Missing transfer rates page.
// Sales admins only (the admin layout checks).
export const maxDuration = 60;

const AREAS: { area: CoverageArea; title: string; help: string }[] = [
  { area: "Accommodation", title: "Accommodation", help: "Rooms with no rate for some months (Indian or foreign guests)." },
  { area: "Child rate", title: "Child rates", help: "A child of 8 sharing the room is charged nothing: add the child / extra-bed rate." },
  { area: "Safari", title: "Safaris", help: "Core and buffer, morning and evening, booked 30 and 90 days ahead." },
  { area: "Full-day safari", title: "Full-day safaris", help: "No full-day safari rate and no full-day add-on at a lodge in the park. Ignore a park where you never sell it." },
  { area: "Naturalist", title: "Naturalists", help: "No naturalist fee on the safari rate, no naturalist add-on, and the rate is not marked \"Naturalist included\"." },
  { area: "Activity", title: "Activities", help: "Add-ons with no price." },
];

export default async function RateCoveragePage() {
  const todayIST = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const [{ data, error }, transfers] = await Promise.all([loadPricingData(), loadMissingTransfers()]);
  const issues = error ? [] : rateCoverage(data, todayIST);
  return <RateCoverageView issues={issues} roads={transfers.pairs.length} months={seasonMonths(todayIST)} error={error} transfersError={transfers.error} />;
}

function RateCoverageView({ issues, roads, months, error, transfersError }: { issues: CoverageIssue[]; roads: number; months: number; error: string | null; transfersError: string | null }) {
  const total = issues.length + roads;
  const transfers = { pairs: { length: roads }, error: transfersError };
  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
        <h1 className="mt-1 text-2xl">Rate coverage</h1>
        <p className="mt-1 max-w-3xl text-sm text-sand-500">
          Every price a quote can need, checked by pricing it: each room for Indian and foreign guests month by month ({months} months, to the end of the season),
          each park&apos;s safaris, full-day safaris and naturalists, the activities, and every road. When this page is empty, no quote on our circuit asks for a price to be typed.
        </p>
      </div>

      {error && <p className={ui.alertError}>Could not load the rates: {error}</p>}
      {transfers.error && <p className={ui.alertError}>Could not load the transfers: {transfers.error}</p>}
      {!error && total === 0 && <div className={ui.empty}>Every price a quote can need is in Master data.</div>}

      <section className={`${ui.card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 px-4 py-3">
          <h2 className="text-base">Transfers</h2>
          <Link href="/sales/admin/missing-transfers" className={ui.btnSecondary}>
            <Icon name="car" className="h-[18px] w-[18px]" />
            {transfers.pairs.length ? `${transfers.pairs.length} road${transfers.pairs.length === 1 ? "" : "s"} without a rate` : "All roads have a rate"}
          </Link>
        </div>
      </section>

      {AREAS.map(({ area, title, help }) => {
        const rows = issues.filter((i) => i.area === area);
        if (!rows.length) return null;
        return (
          <section key={area} className={`${ui.card} overflow-hidden`}>
            <div className="border-b border-sand-200 px-4 py-3">
              <h2 className="text-base">
                {title} <span className="text-sm font-normal text-sand-500">({rows.length})</span>
              </h2>
              <p className="mt-0.5 text-xs text-sand-500">{help}</p>
            </div>
            <ul className="divide-y divide-sand-100 text-sm">
              {rows.map((r, k) => (
                <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                  <span className="min-w-0 flex-1 font-medium text-olive-900">{r.item}</span>
                  <span className="text-sand-600">{r.detail}</span>
                  {r.href && (
                    <Link href={r.href} className="text-xs font-semibold text-olive-700 underline">
                      Fix in Master data
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
