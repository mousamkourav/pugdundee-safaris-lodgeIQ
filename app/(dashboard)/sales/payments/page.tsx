import Link from "next/link";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatCard } from "@/components/sales/stat-card";
import { MakeMissingBookings } from "@/components/sales/payments/make-missing";
import { PaymentsTable } from "@/components/sales/payments/payments-table";
import { getMemberNames } from "@/lib/sales/members";
import { rupees } from "@/lib/sales/format";
import { loadBookings } from "@/lib/sales/payments/server";
import { filterBookings, filterQuery, readFilters } from "@/lib/sales/payments/filters";
import { summarise, STATUS_TEXT, type BookingStatus } from "@/lib/sales/payments/money";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { profile } = await requireUser();
  const admin = isSalesAdmin(profile?.role);
  const sp = await searchParams;
  const f = readFilters(sp);
  const view = sp.view === "guest" ? "guest" : "lodge";
  const supabase = await createClient();
  const { bookings, error, notReady } = await loadBookings(supabase);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const rows = filterBookings(bookings, admin ? f : { ...f, owner: "" }, today);
  const totals = summarise(rows, today);
  const lodges = [...new Set(bookings.flatMap((b) => b.lines.map((l) => l.lodge_name)).filter(Boolean))].sort();
  const { members } = admin ? await getMemberNames(bookings.map((b) => b.owner_id).filter((x): x is string => !!x)) : { members: [] };
  const qs = filterQuery(f);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Sales</p>
          <h1 className="mt-1 text-2xl">Payments</h1>
          <p className="mt-1 text-sm text-sand-500">Every booking, what is paid and what is still due. {admin ? "All members." : "Your bookings."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/sales/payments/new" className={ui.btnPrimary}>
            <Icon name="plus" className="h-4 w-4" />
            Add booking
          </Link>
          <a href={`/api/sales/payments/export${qs ? `?${qs}` : ""}`} className={ui.btnSecondary}>
            <Icon name="fileText" className="h-4 w-4" />
            Export Excel
          </a>
          {admin && (
            <Link href="/sales/payments/import" className={ui.btnSecondary}>
              Import Excel
            </Link>
          )}
        </div>
      </div>

      {notReady ? (
        <p className={ui.alertWarning}>Payments are not set up yet. Run supabase/sales_payments.sql in the Supabase SQL Editor, then reload.</p>
      ) : error ? (
        <p className={ui.alertError}>Could not load the payments: {error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Trip value" value={rupees(totals.value)} hint={`${rows.length} booking${rows.length === 1 ? "" : "s"}`} />
        <StatCard label="Received" value={rupees(totals.received)} hint={`This month ${rupees(totals.receivedThisMonth)}`} valueClass="!text-success" />
        <StatCard label="Balance" value={rupees(totals.balance)} hint={`Due this week ${rupees(totals.dueThisWeek)}`} highlight />
        <StatCard label="Overdue" value={rupees(totals.overdue.amount)} hint={`${totals.overdue.count} booking${totals.overdue.count === 1 ? "" : "s"}`} valueClass={totals.overdue.count ? "!text-error" : ""} />
      </div>

      <form className={`${ui.card} grid grid-cols-2 gap-3 p-4 md:grid-cols-6`} method="get">
        <input type="hidden" name="view" value={view} />
        <label className="col-span-2 md:col-span-2">
          <span className={ui.label}>Search</span>
          <input name="q" defaultValue={f.q} placeholder="Guest, booking no. or query no." className={ui.inputSm} />
        </label>
        <label>
          <span className={ui.label}>Check-in month</span>
          <input type="month" name="month" defaultValue={f.month} className={ui.inputSm} />
        </label>
        <label>
          <span className={ui.label}>Status</span>
          <select name="status" defaultValue={f.status} className={`${ui.select} w-full !py-2`}>
            <option value="">All</option>
            {(Object.keys(STATUS_TEXT) as BookingStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_TEXT[s]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className={ui.label}>Lodge</span>
          <select name="lodge" defaultValue={f.lodge} className={`${ui.select} w-full !py-2`}>
            <option value="">All</option>
            {lodges.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        {admin ? (
          <label>
            <span className={ui.label}>Salesperson</span>
            <select name="owner" defaultValue={f.owner} className={`${ui.select} w-full !py-2`}>
              <option value="">All</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name || "Unnamed"}</option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-6">
          <button className={`${ui.btnPrimary} ${ui.btnSm}`}>Apply</button>
          <Link href={`/sales/payments?view=${view}`} className={`${ui.btnGhost} ${ui.btnSm}`}>Clear</Link>
          <span className="ml-auto flex gap-1 text-xs">
            <Link href={`/sales/payments?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), view: "lodge" })}`} className={`rounded-full px-3 py-1 ${view === "lodge" ? "bg-olive-600 text-white" : "bg-sand-100 text-sand-600"}`}>
              By lodge booking
            </Link>
            <Link href={`/sales/payments?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), view: "guest" })}`} className={`rounded-full px-3 py-1 ${view === "guest" ? "bg-olive-600 text-white" : "bg-sand-100 text-sand-600"}`}>
              By guest
            </Link>
          </span>
        </div>
      </form>

      {admin && !notReady && <MakeMissingBookings />}

      {rows.length === 0 ? (
        <div className={ui.empty}>{bookings.length ? "No bookings match these filters." : "No bookings yet. A booking is made when a query is marked Booked, or add one by hand."}</div>
      ) : (
        <PaymentsTable rows={rows} view={view} today={today} />
      )}
    </div>
  );
}
