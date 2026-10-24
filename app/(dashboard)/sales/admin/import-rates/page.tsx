import Link from "next/link";
import { RatesImporter } from "@/components/sales/rates-importer";

// Import the rates workbook back after management has reviewed it.
// Sales admins only (the admin layout checks; the route and action check again).
export default function ImportRatesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
        <h1 className="mt-1 text-2xl">Import rates from Excel</h1>
        <p className="mt-1 text-sm text-sand-500">
          Choose the workbook from <a href="/api/sales/rates-export" className="font-semibold text-olive-600 underline">Export all rates</a> after the yellow cells were changed. You see every change before anything is saved.
        </p>
      </div>
      <RatesImporter />
    </div>
  );
}
