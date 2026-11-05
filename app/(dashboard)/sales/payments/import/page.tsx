import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { PaymentsImporter } from "@/components/sales/payments/importer";

export const metadata = { title: "Import payments" };

// Sales admins only (the route and the action check again).
export default async function ImportPaymentsPage() {
  const { profile } = await requireUser();
  if (!isSalesAdmin(profile?.role)) redirect("/sales/payments");
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <Link href="/sales/payments" className="text-xs font-medium text-sand-500 hover:text-olive-600">Payments</Link>
        <h1 className="mt-1 text-2xl">Import the payments Excel</h1>
        <p className="mt-1 text-sm text-sand-500">
          Once, to bring the sheet the team kept before LodgeIQ. Columns are found by their headings (Check In, Check Out, Booking No., Guest Name, Rooms, Nights, R. / S. / T. Tariff, Total, Payment 1, Date...). You see everything before it is saved; nothing is guessed.
        </p>
      </div>
      <PaymentsImporter />
    </div>
  );
}
