import Link from "next/link";
import { notFound } from "next/navigation";
import { isSalesAdmin } from "@/lib/auth";
import { requireRpUser } from "@/lib/redpanda/server";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/sales/status-badge";
import { StatusActions } from "@/components/sales/status-actions";
import { ShareLink } from "@/components/sales/share-link";
import { DraftActions } from "@/components/sales/draft-actions";
import { DeleteQueryButton } from "@/components/sales/delete-query";
import { todayIST } from "@/lib/sales/plan/load-context";
import { getMemberNames } from "@/lib/sales/members";
import { rupees, fmtDate, fmtDay, fmtRange, daysSince } from "@/lib/sales/format";
import { MARKET_LABEL } from "@/lib/redpanda/pricing";
import { sanitizeRpPlan } from "@/lib/redpanda/plan";
import type { QueryStatus } from "@/lib/sales/status";
import type { RpPrice } from "@/lib/redpanda/types";
import { clientLinkPath } from "@/lib/sales/quote-link";
import { ClientLinkSwitch } from "@/components/sales/client-link-switch";

interface QueryRow {
  id: string;
  query_no: string;
  status: QueryStatus;
  query_type?: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  assigned_to: string | null;
  created_by: string | null;
  booked_amount: number | null;
  payment_ref: string | null;
  booked_at: string | null;
  lost_reason: string | null;
  created_at: string;
}

const EVENT_LABEL: Record<string, string> = { created: "Query created", version: "New version", status: "Status changed", reassigned: "Reassigned" };

// A Red Panda quote: the same status workflow, versions, guest link and payments as any Sales
// query, with its own price view. Sales > Queries sends Red Panda quotes here.
export default async function RedPandaQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireRpUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const admin = isSalesAdmin(profile?.role);
  const supabase = await createClient();
  const { data: qData } = await supabase.from("sales_queries").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  const q = qData as QueryRow | null;
  if (!q || q.query_type !== "red_panda") notFound();

  const [{ data: vData }, { data: latest }, { data: eData }, { data: bookingRow }, { data: rData }] = await Promise.all([
    supabase.from("sales_itinerary_versions").select("id, version_no, total_amount, created_by, created_at, share_token, share_slug").eq("query_id", id).order("version_no", { ascending: false }),
    supabase.from("sales_itinerary_versions").select("id, plan, pricing").eq("query_id", id).order("version_no", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sales_query_events").select("event_type, from_status, to_status, remark, actor, created_at").eq("query_id", id).order("created_at", { ascending: false }),
    supabase.from("sales_bookings").select("id").eq("query_id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("sales_reasons").select("kind, label").eq("active", true).order("sort"),
  ]);
  const versions = (vData ?? []) as { id: string; version_no: number; total_amount: number; created_by: string | null; created_at: string; share_token: string; share_slug: string | null }[];
  const full = latest as { id: string; plan: unknown; pricing: RpPrice } | null;
  const plan = full ? sanitizeRpPlan(full.plan) : null;
  const price = full?.pricing && full.pricing.totals ? full.pricing : null;
  const events = (eData ?? []) as { event_type: string; from_status: string | null; to_status: string | null; remark: string | null; actor: string | null; created_at: string }[];
  const bookingId = (bookingRow as { id: string } | null)?.id ?? null;
  const reasonRows = (rData ?? []) as { kind: string; label: string }[];
  const reasons = { lost: reasonRows.filter((r) => r.kind === "lost").map((r) => r.label), cancelled: reasonRows.filter((r) => r.kind === "cancelled").map((r) => r.label) };

  const people = [q.assigned_to, q.created_by, ...versions.map((v) => v.created_by), ...events.map((e) => e.actor)].filter((x): x is string => !!x);
  const memberInfo = await getMemberNames(people);
  const names = memberInfo.names;
  if (profile?.id && profile?.full_name) names[profile.id] = profile.full_name;
  const members = admin ? memberInfo.members.filter((m) => m.status !== "disabled").map((m) => ({ id: m.id, name: m.full_name || "Unnamed" })) : [];
  const canAct = admin || q.assigned_to === user.id;
  const isDraft = q.status === "draft";
  const canEdit = canAct && (q.status === "open" || q.status === "booked");
  const current = versions[0];

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-xs text-sand-500">
        <Link href="/red-panda" className="hover:text-olive-600">Red Panda quotes</Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-olive-800">{q.query_no}</span>
      </nav>

      <div className={`${ui.card} flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between`}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl">{q.query_no}</h1>
            <StatusBadge status={q.status} />
            <span className="rounded-md border border-gold-200 bg-gold-50 px-2 py-0.5 text-xs font-semibold text-gold-800">Red Panda</span>
            {q.status === "open" && <span className="text-sm text-sand-500">open for {daysSince(q.created_at)} days</span>}
          </div>
          <p className="mt-1 text-sm text-sand-500">
            {q.guest_name} &middot; {fmtRange(q.arrival_date, q.departure_date)}
            {q.assigned_to && <> &middot; Assigned to <b className="text-olive-800">{names[q.assigned_to] ?? "member"}</b></>}
          </p>
        </div>
        {admin && (
          <div className="order-last lg:order-none">
            <DeleteQueryButton queryId={q.id} queryNo={q.query_no} guestName={q.guest_name} />
          </div>
        )}
        {isDraft ? (
          // "Continue editing" opens /sales/new?from=..., which sends a Red Panda quote to its builder
          canAct && <DraftActions queryId={q.id} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <StatusActions
              queryId={q.id}
              queryNo={q.query_no}
              status={q.status}
              isAdmin={admin}
              canAct={canAct}
              reasons={reasons}
              members={members}
              assignedTo={q.assigned_to}
              deposit={q.status === "open" ? price?.payments?.[0]?.amount ?? null : null}
              today={todayIST()}
            />
            {canEdit && (
              <Link href={`/red-panda/new?from=${q.id}`} className={ui.btnSecondary}>
                <Icon name="edit" className="h-[18px] w-[18px]" />
                New version
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {price && plan && (
            <section className={`${ui.card} p-5`}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-lg">Price (version {current?.version_no})</h2>
                <div className="text-right">
                  <p className="tabular font-display text-2xl font-semibold text-olive-800">{rupees(price.totals.grand)}</p>
                  <p className="text-xs text-sand-500">{rupees(price.perPerson)} per person &middot; {MARKET_LABEL[price.market]}{price.season ? ` - ${price.season}` : ""}</p>
                </div>
              </div>
              <ul className="mt-4 divide-y divide-sand-100 text-sm">
                {price.lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0"><span className="block font-medium text-olive-800">{l.label}</span><span className="block text-xs text-sand-500">{l.detail}</span></span>
                    <span className="tabular shrink-0">{rupees(l.amount)}</span>
                  </li>
                ))}
                {price.totals.markup > 0 && <li className="flex justify-between py-2"><span>Markup ({plan.markup_pct}%)</span><span className="tabular">{rupees(price.totals.markup)}</span></li>}
                {price.totals.discount > 0 && <li className="flex justify-between py-2"><span>Discount</span><span className="tabular">-{rupees(price.totals.discount)}</span></li>}
                <li className="flex justify-between py-2"><span>GST on the package</span><span className="tabular">{rupees(price.totals.package_gst)}</span></li>
                {price.lines.filter((l) => l.group !== "package" && l.gst > 0).map((l) => (
                  <li key={`${l.key}-t`} className="flex justify-between py-2 text-sand-600"><span>Tax on {l.label.split(",")[0]}</span><span className="tabular">{rupees(l.gst)}</span></li>
                ))}
                {price.totals.adjustment !== 0 && <li className="flex justify-between py-2"><span>Adjustment{plan.adjustment.reason ? ` (${plan.adjustment.reason})` : ""}</span><span className="tabular">{rupees(price.totals.adjustment)}</span></li>}
              </ul>
              {price.payments.length > 0 && (
                <div className="mt-3 rounded-lg bg-sand-50 p-3 text-sm">
                  {price.payments.map((p) => (
                    <p key={p.label} className="flex justify-between gap-3"><span>{p.label} ({p.pct}%), {p.due ? `by ${fmtDay(p.due)}` : (p.note ?? "at booking")}</span><span className="tabular font-medium">{rupees(p.amount)}</span></p>
                  ))}
                </div>
              )}
              {price.warnings.length > 0 && <ul className={`${ui.alertWarning} mt-3 list-disc pl-6`}>{price.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </section>
          )}

          {plan && (
            <section className={`${ui.card} p-5`}>
              <h2 className="text-lg">Trip</h2>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {([
                  ["Arrival", plan.dateless ? `Not fixed yet (tariff ${price?.season ?? plan.rate_season ?? "newest"})` : fmtDay(price?.arrival ?? plan.arrival)],
                  ["Departure", fmtDay(price?.departure ?? null)],
                  ["Red Panda Outpost", `${plan.nights} nights${price?.outpost.check_in ? `, from ${fmtDay(price.outpost.check_in)}` : ""}`],
                  ["Airports", `${plan.arrive_airport} in, ${plan.depart_airport} out`],
                  ["Guests", `${plan.guest.adults} adult${plan.guest.adults === 1 ? "" : "s"}${plan.guest.child_ages.length ? `, aged ${plan.guest.child_ages.join(", ")}` : ""}${plan.tour_leader ? " + tour leader" : ""}`],
                  ["Rooms", String(price?.rooms ?? "-")],
                  ["Nationality", plan.guest.nationality === "indian" ? "Indian" : "Foreign"],
                  ["Booked by", plan.guest.booked_by === "agent" ? `Travel agent${plan.guest.agent_name ? ` (${plan.guest.agent_name})` : ""}` : "Direct"],
                  ["Email", q.guest_email || "-"],
                  ["Phone", q.guest_phone || "-"],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 sm:block"><dt className="text-sand-500">{k}</dt><dd className="font-medium text-olive-800">{v || "-"}</dd></div>
                ))}
              </dl>
              {plan.notes && <p className="mt-3 rounded-lg bg-sand-50 p-3 text-sm">{plan.notes}</p>}
            </section>
          )}

          <section className={`${ui.card} p-5`}>
            <h2 className="text-lg">History</h2>
            <ol className="mt-4 space-y-4 border-l-2 border-sand-200 pl-4">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span className={"absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white " + (i === 0 ? "bg-olive-600" : "bg-sand-300")} />
                  <p className="text-sm font-semibold text-olive-800">{EVENT_LABEL[e.event_type] ?? e.event_type}{e.event_type === "status" && e.to_status ? `: ${e.from_status} to ${e.to_status}` : ""}</p>
                  <p className="text-xs text-sand-500">{fmtDate(e.created_at)} &middot; {(e.actor && names[e.actor]) || "system"}</p>
                  {e.remark && <p className="mt-1 rounded-lg bg-sand-50 p-2 text-sm">{e.remark}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-6">
          {current && !isDraft && (
            <section className={`${ui.card} p-5`}>
              <h2 className="text-lg">Guest link</h2>
              <p className="mt-1 text-sm text-sand-500">The Red Panda page and PDF for version {current.version_no}.</p>
              <div className="mt-3"><ShareLink path={clientLinkPath((q as { share_key?: string | null }).share_key, current)} /></div>
              <ClientLinkSwitch queryId={q.id} off={!!(q as { share_disabled_at?: string | null }).share_disabled_at} />
            </section>
          )}
          {q.status === "booked" && (
            <section className="rounded-xl border border-success-border bg-success-bg p-5 text-sm">
              <h2 className="text-lg">Booking</h2>
              <dl className="mt-3 space-y-2">
                <div className="flex justify-between gap-3"><dt className="text-sand-600">Amount received</dt><dd className="tabular font-semibold text-olive-800">{rupees(q.booked_amount)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-sand-600">Payment date</dt><dd className="font-medium text-olive-800">{fmtDate(q.booked_at)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-sand-600">Reference</dt><dd className="font-medium text-olive-800">{q.payment_ref || "-"}</dd></div>
              </dl>
              {bookingId && <Link href={`/sales/payments/${bookingId}`} className={`${ui.btnSecondary} ${ui.btnSm} mt-3`}>Payments, balance and due dates</Link>}
            </section>
          )}
          {(q.status === "lost" || q.status === "cancelled") && q.lost_reason && (
            <section className={`${ui.muted} p-5 text-sm`}>
              <h2 className="text-lg">{q.status === "lost" ? "Lost" : "Cancelled"}</h2>
              <p className="mt-2"><span className="text-sand-500">Reason: </span><span className="font-medium text-olive-800">{q.lost_reason}</span></p>
            </section>
          )}
          <section className={`${ui.card} p-5`}>
            <h2 className="text-lg">Versions</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex justify-between gap-3">
                  <span>Version {v.version_no} &middot; {fmtDate(v.created_at)}</span>
                  <span className="tabular">{rupees(v.total_amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
