import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { BookingView } from "@/components/sales/payments/booking-view";
import { getMemberNames } from "@/lib/sales/members";
import { loadAudit, loadBooking, loadRemovedPayments } from "@/lib/sales/payments/server";
import { auditText } from "@/lib/sales/payments/audit-text";

export const metadata = { title: "Booking payments" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // row level security: a member opens only their own bookings
  const { booking, error, notReady } = await loadBooking(supabase, id);
  if (notReady) return <p className={ui.alertWarning}>Payments are not set up yet. Run supabase/sales_payments.sql in the Supabase SQL Editor.</p>;
  if (error) return <p className={ui.alertError}>Could not load the booking: {error}</p>;
  if (!booking) notFound();
  const [removed, auditRows] = await Promise.all([loadRemovedPayments(supabase, id), loadAudit(supabase, id)]);
  const { names } = await getMemberNames([booking.owner_id, ...auditRows.map((a) => a.actor)].filter((x): x is string => !!x));
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const audit = auditRows.map((a) => ({ id: a.id, table_name: a.table_name, action: a.action, reason: a.reason, actor: a.actor, at: a.at, summary: auditText(a, names) }));
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <Link href="/sales/payments" className="text-xs font-medium text-sand-500 hover:text-olive-600">Payments</Link>
        <h1 className="mt-1 text-2xl">{booking.guest_name}</h1>
        {booking.query_id && (
          <p className="mt-1 text-sm text-sand-500">
            Quote <Link href={`/sales/queries/${booking.query_id}`} className="font-medium text-olive-600 underline">{booking.query_no ?? "open"}</Link>
          </p>
        )}
      </div>
      <BookingView booking={booking} removed={removed} audit={audit} ownerName={booking.owner_id ? names[booking.owner_id] ?? null : null} admin={isSalesAdmin(profile?.role)} today={today} />
    </div>
  );
}
