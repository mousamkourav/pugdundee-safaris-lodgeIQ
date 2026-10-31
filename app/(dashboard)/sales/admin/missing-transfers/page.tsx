import Link from "next/link";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees } from "@/lib/sales/format";
import { PAIR_KIND_LABEL } from "@/lib/sales/master/missing-transfers";
import { loadMissingTransfers } from "@/lib/sales/master/missing-transfers-data";

// Roads a quote can need with no rate in Master data (lib/sales/master/missing-transfers.ts),
// the ones quotes needed most first. Fix one with "Add rate", or all of them in Excel.
// Sales admins only (the admin layout checks).
export default async function MissingTransfersPage() {
  const { pairs, error } = await loadMissingTransfers();
  const needed = pairs.filter((p) => p.needed > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
          <h1 className="mt-1 text-2xl">Missing transfer rates</h1>
          <p className="mt-1 max-w-3xl text-sm text-sand-500">
            Roads a quote can need that have no rate yet: between our lodges, from each park&apos;s airports and stations, city hotels to their airport, and every road a saved quote had to price by hand.
            One rate covers both directions. Fill them in here one by one, or download the sheet for management and import it back.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/sales/missing-transfers" className={ui.btnSecondary}>
            <Icon name="fileText" className="h-[18px] w-[18px]" />
            Download for Excel
          </a>
          <Link href="/sales/admin/import-rates" className={ui.btnSecondary}>
            <Icon name="fileSearch" className="h-[18px] w-[18px]" />
            Import the filled sheet
          </Link>
        </div>
      </div>

      {error && <p className={ui.alertError}>Could not load: {error}</p>}

      {pairs.length === 0 ? (
        <div className={ui.empty}>Every road quotes need has a rate.</div>
      ) : (
        <div className={`${ui.card} overflow-hidden`}>
          <p className="border-b border-sand-200 px-4 py-3 text-sm text-sand-600">
            {pairs.length} road{pairs.length === 1 ? "" : "s"} without a rate{needed ? `; ${needed} of them already needed in quotes` : ""}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                  <th className="px-4 py-2">From</th>
                  <th className="px-4 py-2">To</th>
                  <th className="px-4 py-2">Why</th>
                  <th className="px-4 py-2 text-right">Needed in quotes</th>
                  <th className="px-4 py-2 text-right">Last price typed</th>
                  <th className="px-4 py-2" aria-label="Fix" />
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={`${p.from_id}-${p.to_id}`} className="border-t border-sand-100">
                    <td className="px-4 py-2 text-olive-800">{p.from_name}</td>
                    <td className="px-4 py-2 text-olive-800">{p.to_name}</td>
                    <td className="px-4 py-2 text-sand-600">{PAIR_KIND_LABEL[p.kind]}</td>
                    <td className="tabular px-4 py-2 text-right">{p.needed || "-"}</td>
                    <td className="tabular px-4 py-2 text-right">{p.last_price ? rupees(p.last_price) : "-"}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/sales/admin/transfers/new?f_from_location_id=${encodeURIComponent(p.from_id)}&f_to_location_id=${encodeURIComponent(p.to_id)}`} className={`${ui.btnGhost} ${ui.btnSm} whitespace-nowrap`}>
                        <Icon name="plus" className="h-3.5 w-3.5" />
                        Add rate
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
