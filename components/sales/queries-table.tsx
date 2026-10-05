import Link from "next/link";
import { ui } from "@/components/ui";
import { StatusBadge } from "./status-badge";
import { rupees, fmtRange, fmtDate, daysSince } from "@/lib/sales/format";
import type { QueryRow } from "@/lib/sales/status";

// Shared list table for dashboard, queries and lost/cancelled pages.
// Server component: no interactivity yet (row actions arrive with query detail).
export function QueriesTable({
  rows,
  memberNames,
  showMember = false,
  showAge = false,
  remarks,
  empty = "No queries yet.",
}: {
  rows: QueryRow[];
  memberNames?: Record<string, string>;
  showMember?: boolean;
  showAge?: boolean;
  remarks?: Record<string, string>; // query id -> latest status remark
  empty?: string;
}) {
  if (rows.length === 0) return <div className={ui.empty}>{empty}</div>;

  return (
    <div className={`${ui.card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
              <th className="whitespace-nowrap px-4 py-3">Query</th>
              <th className="px-4 py-3">Guest</th>
              <th className="whitespace-nowrap px-4 py-3">Travel</th>
              <th className="px-4 py-3">Parks</th>
              {showMember && <th className="px-4 py-3">Member</th>}
              <th className="px-4 py-3 text-right">Value</th>
              {showAge && <th className="whitespace-nowrap px-4 py-3">Open for</th>}
              {remarks && <th className="px-4 py-3">Reason / remark</th>}
              {!showAge && <th className="px-4 py-3">Updated</th>}
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const age = daysSince(r.created_at);
              return (
                <tr key={r.id} className="border-t border-sand-200 align-middle hover:bg-sand-50">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-olive-600">
                    <Link href={`/sales/queries/${r.id}`} className="hover:underline">{r.query_no}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-olive-800">{r.guest_name}</p>
                    <p className="text-xs capitalize text-sand-500">{r.nationality}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{fmtRange(r.arrival_date, r.departure_date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(r.parks ?? []).map((p) => (
                        <span key={p} className="rounded-md bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-700">
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  {showMember && (
                    <td className="whitespace-nowrap px-4 py-3">
                      {(r.assigned_to && memberNames?.[r.assigned_to]) || "-"}
                    </td>
                  )}
                  <td className="tabular whitespace-nowrap px-4 py-3 text-right">
                    {rupees(r.status === "booked" ? r.booked_amount ?? r.total_amount : r.total_amount)}
                  </td>
                  {showAge && (
                    <td className={"whitespace-nowrap px-4 py-3 " + (age > 5 ? "font-semibold text-warning" : "")}>
                      {age} {age === 1 ? "day" : "days"}
                    </td>
                  )}
                  {remarks && (
                    <td className="max-w-xs px-4 py-3">
                      {r.lost_reason && <p className="font-medium text-sand-700">{r.lost_reason}</p>}
                      <p className="text-xs text-sand-500">{remarks[r.id] ?? ""}</p>
                    </td>
                  )}
                  {!showAge && <td className="whitespace-nowrap px-4 py-3">{fmtDate(r.updated_at)}</td>}
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
