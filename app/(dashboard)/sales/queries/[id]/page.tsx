import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/sales/status-badge";
import { StatusActions } from "@/components/sales/status-actions";
import { ShareLink } from "@/components/sales/share-link";
import { todayIST } from "@/lib/sales/plan/load-context";
import { getMemberNames } from "@/lib/sales/members";
import { rupees, fmtDate, fmtRange, daysSince } from "@/lib/sales/format";
import { dayName } from "@/lib/sales/pricing/dates";
import type { QueryStatus } from "@/lib/sales/status";
import type { Plan } from "@/lib/sales/plan/types";
import type { PriceResult } from "@/lib/sales/pricing/types";

interface QueryFull {
  id: string;
  query_no: string;
  status: QueryStatus;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  nationality: string;
  adults: number;
  children: number[];
  rooms: number;
  source: string | null;
  agent_name: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  parks: string[];
  total_amount: number | null;
  currency: string;
  assigned_to: string | null;
  created_by: string | null;
  booked_amount: number | null;
  payment_ref: string | null;
  booked_at: string | null;
  lost_reason: string | null;
  created_at: string;
}

const EVENT_LABEL: Record<string, string> = {
  created: "Query created",
  version: "New itinerary version",
  status: "Status changed",
  reassigned: "Reassigned",
};

export default async function QueryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, profile } = await requireUser();
  const admin = isSuperAdmin(profile?.role);
  const supabase = await createClient();

  const { data: qData } = await supabase.from("sales_queries").select("*").eq("id", id).maybeSingle();
  if (!qData) notFound();
  const q = qData as unknown as QueryFull;

  const [{ data: vData }, { data: eData }] = await Promise.all([
    supabase
      .from("sales_itinerary_versions")
      .select("id, version_no, total_amount, currency, created_by, created_at, share_token, plan, pricing")
      .eq("query_id", id)
      .order("version_no", { ascending: false }),
    supabase
      .from("sales_query_events")
      .select("event_type, from_status, to_status, remark, actor, created_at, extra")
      .eq("query_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const versions = (vData ?? []) as { id: string; version_no: number; total_amount: number; currency: string; created_by: string | null; created_at: string; share_token: string; plan: Plan; pricing: PriceResult }[];
  const events = (eData ?? []) as { event_type: string; from_status: string | null; to_status: string | null; remark: string | null; actor: string | null; created_at: string }[];
  const current = versions[0];

  const people = [q.assigned_to, q.created_by, ...versions.map((v) => v.created_by), ...events.map((e) => e.actor)].filter((x): x is string => !!x);
  const memberInfo = await getMemberNames(people);
  const names = memberInfo.names;
  if (profile?.id && profile?.full_name) names[profile.id] = profile.full_name;

  const plan = current?.plan;
  const pricing = current?.pricing;
  const canAct = admin || q.assigned_to === user.id;
  const canEdit = canAct && (q.status === "open" || q.status === "booked");

  const { data: rData } = await supabase.from("sales_reasons").select("kind, label").eq("active", true).order("sort");
  const reasonRows = (rData ?? []) as { kind: string; label: string }[];
  const reasons = {
    lost: reasonRows.filter((r) => r.kind === "lost").map((r) => r.label),
    cancelled: reasonRows.filter((r) => r.kind === "cancelled").map((r) => r.label),
  };
  const members = admin
    ? memberInfo.members.filter((m) => m.status !== "disabled").map((m) => ({ id: m.id, name: m.full_name || "Unnamed" }))
    : [];
  const deposit = pricing?.payments?.[0]?.amount ?? null;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-xs text-sand-500">
        <Link href="/sales/queries" className="hover:text-olive-600">Queries</Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-olive-800">{q.query_no}</span>
      </nav>

      <div className={`${ui.card} flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between`}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl">{q.query_no}</h1>
            <StatusBadge status={q.status} />
            {q.status === "open" && <span className="text-sm text-sand-500">open for {daysSince(q.created_at)} days</span>}
          </div>
          <p className="mt-1 text-sm text-sand-500">
            {q.guest_name} &middot; {fmtRange(q.arrival_date, q.departure_date)} &middot; {(q.parks ?? []).join(", ")}
            {q.assigned_to && <> &middot; Assigned to <b className="text-olive-800">{names[q.assigned_to] ?? "member"}</b></>}
          </p>
        </div>
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
            deposit={q.status === "open" ? deposit : null}
            today={todayIST()}
          />
          {canEdit && (
            <Link href={`/sales/new?from=${q.id}`} className={ui.btnSecondary}>
              <Icon name="clipboard" className="h-[18px] w-[18px]" />
              Edit as new version
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {pricing && (
            <section className={`${ui.card} p-5`}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-lg">Price (version {current.version_no})</h2>
                <div className="text-right">
                  <p className="tabular font-display text-2xl font-semibold text-olive-800">{rupees(pricing.totals.grand)}</p>
                  <p className="text-xs text-sand-500">{rupees(pricing.perPerson)} per person</p>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                      <th className="px-3 py-2">Lodge</th>
                      <th className="px-3 py-2 text-right">Rooms</th>
                      <th className="px-3 py-2 text-right">Safaris</th>
                      <th className="px-3 py-2 text-right">Transfers</th>
                      <th className="px-3 py-2 text-right">Discount</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pricing.byProperty.map((p) => (
                      <tr key={p.property_id ?? "none"} className="border-t border-sand-200">
                        <td className="px-3 py-2 font-medium text-olive-800">{p.name}</td>
                        <td className="tabular px-3 py-2 text-right">{rupees(p.room)}</td>
                        <td className="tabular px-3 py-2 text-right">{rupees(p.safari)}</td>
                        <td className="tabular px-3 py-2 text-right">{rupees(p.transfer)}</td>
                        <td className="tabular px-3 py-2 text-right">{p.discount ? rupees(p.discount) : "-"}</td>
                        <td className="tabular px-3 py-2 text-right font-semibold">{rupees(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 space-y-1 text-sm">
                {pricing.payments.map((p, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>{p.label}<span className="text-sand-500"> - {p.due ? `by ${fmtDate(p.due)}` : "at booking"}</span></span>
                    <span className="tabular">{rupees(p.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {plan && (
            <section className={`${ui.card} p-5`}>
              <h2 className="text-lg">Day by day</h2>
              <ol className="mt-4 space-y-4">
                {plan.days.map((d, i) => (
                  <li key={i} className="grid gap-1 sm:grid-cols-[150px_1fr]">
                    <div>
                      <p className="font-display font-semibold text-olive-800">Day {i + 1}</p>
                      <p className="text-xs text-sand-500">{fmtDate(d.date)} ({dayName(d.date)})</p>
                    </div>
                    <div>
                      <p className="font-medium text-olive-800">{d.title}</p>
                      <p className="text-sm">{d.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className={`${ui.card} overflow-hidden`}>
            <div className="border-b border-sand-200 p-5"><h2 className="text-lg">Versions</h2></div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">By</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.id} className="border-t border-sand-200">
                    <td className="px-4 py-3 font-semibold text-olive-800">v{v.version_no}{i === 0 && <span className="ml-2 text-xs font-medium text-success">current</span>}</td>
                    <td className="px-4 py-3">{fmtDate(v.created_at)}</td>
                    <td className="px-4 py-3">{(v.created_by && names[v.created_by]) || "-"}</td>
                    <td className="tabular px-4 py-3 text-right">{rupees(v.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="space-y-6">
          {current && (
            <section className={`${ui.card} p-5`}>
              <h2 className="text-lg">Client itinerary</h2>
              <p className="mb-3 mt-1 text-sm text-sand-500">Version {current.version_no}, with photos and payment terms. Costs by lodge are never shown to the guest.</p>
              <ShareLink path={`/i/${current.share_token}`} />
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
            </section>
          )}

          {(q.status === "lost" || q.status === "cancelled") && q.lost_reason && (
            <section className={`${ui.muted} p-5 text-sm`}>
              <h2 className="text-lg">{q.status === "lost" ? "Lost" : "Cancelled"}</h2>
              <p className="mt-2"><span className="text-sand-500">Reason: </span><span className="font-medium text-olive-800">{q.lost_reason}</span></p>
            </section>
          )}

          <section className={`${ui.card} p-5`}>
            <h2 className="text-lg">Guest</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {([
                ["Name", q.guest_name],
                ["Email", q.guest_email],
                ["Phone", q.guest_phone],
                ["Nationality", q.nationality === "indian" ? "Indian" : "Foreign"],
                ["Guests", `${q.adults} adult${q.adults === 1 ? "" : "s"}${q.children?.length ? `, children aged ${q.children.join(", ")}` : ""}`],
                ["Rooms", String(q.rooms)],
                ["Source", q.source ? `${q.source}${q.agent_name ? ` (${q.agent_name})` : ""}` : null],
              ] as [string, string | null][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-sand-500">{k}</dt><dd className="text-right font-medium text-olive-800">{v || "-"}</dd></div>
              ))}
            </dl>
            {plan?.guest.notes && <p className="mt-3 rounded-lg bg-sand-50 p-3 text-sm">{plan.guest.notes}</p>}
          </section>

          <section className={`${ui.card} p-5`}>
            <h2 className="text-lg">History</h2>
            <ol className="mt-4 space-y-4 border-l-2 border-sand-200 pl-4">
              {events.map((e, i) => (
                <li key={i} className="relative">
                  <span className={"absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white " + (i === 0 ? "bg-olive-600" : "bg-sand-300")} />
                  <p className="text-sm font-semibold text-olive-800">
                    {EVENT_LABEL[e.event_type] ?? e.event_type}
                    {e.event_type === "status" && e.to_status ? `: ${e.from_status} to ${e.to_status}` : ""}
                  </p>
                  <p className="text-xs text-sand-500">{fmtDate(e.created_at)} &middot; {(e.actor && names[e.actor]) || "system"}</p>
                  {e.remark && <p className="mt-1 rounded-lg bg-sand-50 p-2 text-sm">{e.remark}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
