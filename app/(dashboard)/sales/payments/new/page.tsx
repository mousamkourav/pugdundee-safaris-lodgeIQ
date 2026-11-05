import Link from "next/link";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { NewBooking } from "@/components/sales/payments/new-booking";
import { getMemberNames } from "@/lib/sales/members";

export const metadata = { title: "Add booking" };

// A booking made outside LodgeIQ. Members add their own; admins can give it to a salesperson.
export default async function NewBookingPage() {
  const { profile } = await requireUser();
  const admin = isSalesAdmin(profile?.role);
  const members = admin ? (await getMemberNames()).members.map((m) => ({ id: m.id, name: m.full_name || "Unnamed" })) : null;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href="/sales/payments" className="text-xs font-medium text-sand-500 hover:text-olive-600">Payments</Link>
        <h1 className="mt-1 text-2xl">Add a booking</h1>
        <p className="mt-1 text-sm text-sand-500">For a booking made outside LodgeIQ. Quotes marked Booked get their booking by themselves.</p>
      </div>
      <NewBooking members={members} />
    </div>
  );
}
