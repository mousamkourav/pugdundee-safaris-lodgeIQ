import Link from "next/link";
import { Badge, ui } from "@/components/ui";
import { rupees } from "@/lib/sales/format";
import {
  byLine,
  money,
  nextDue,
  status,
  STATUS_TEXT,
  STATUS_TONE,
  type Booking,
} from "@/lib/sales/payments/money";

// dd-mm-yy, like the team's sheet
const dmy = (d: string | null) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}` : "-";

// The Payments list: one row per lodge booking (like the Excel) or one per guest booking.
export function PaymentsTable({
  rows,
  view,
  today,
}: {
  rows: Booking[];
  view: "lodge" | "guest";
  today: string;
}) {
  return (
    <>
      {/* phones: one card per guest booking */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((b) => {
          const st = status(b, today);
          const m = money(b);
          const nd = nextDue(b);
          return (
            <li key={b.id}>
              <Link
                href={`/sales/payments/${b.id}`}
                className={`${ui.card} block p-3`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-olive-800">
                      {b.guest_name}
                    </span>
                    <span className="tabular block text-xs text-sand-500">
                      {dmy(b.check_in)} to {dmy(b.check_out)}
                    </span>
                    <span className="block truncate text-xs text-sand-500">
                      {b.lines
                        .map((l) => l.booking_no || l.lodge_name)
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[st]} dot>
                    {STATUS_TEXT[st]}
                  </Badge>
                </div>
                <div className="tabular mt-2 grid grid-cols-3 gap-2 text-xs">
                  <span>
                    <span className="block text-sand-500">Total</span>
                    {rupees(m.total)}
                  </span>
                  <span>
                    <span className="block text-sand-500">Paid</span>
                    {rupees(m.net)}
                  </span>
                  <span>
                    <span className="block text-sand-500">Balance</span>
                    <b className={m.balance < 0 ? "text-error" : ""}>
                      {rupees(m.balance)}
                    </b>
                  </span>
                </div>
                {nd && (
                  <p className="tabular mt-1 text-xs text-sand-600">
                    Next due {rupees(nd.amount)} on {dmy(nd.due_on)}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className={`${ui.card} hidden overflow-hidden sm:block`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px] [&_td.tabular]:whitespace-nowrap [&_th]:whitespace-nowrap">
            <thead>
              <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                <th className="px-2 py-2">In</th>
                <th className="px-2 py-2">Out</th>
                <th className="px-2 py-2">
                  {view === "lodge" ? "Booking no." : "Lodges"}
                </th>
                <th className="px-2 py-2">Guest</th>
                <th className="px-2 py-2 text-right">Rm</th>
                <th className="px-2 py-2 text-right">Nts</th>
                <th className="px-2 py-2 text-right">Rooms</th>
                <th className="px-2 py-2 text-right">Safaris</th>
                <th className="px-2 py-2 text-right">Transfers</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-2 py-2 text-right">Balance</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((b) => {
                const st = status(b, today);
                const m = money(b);
                const nd = nextDue(b);
                const badge = (
                  <Badge tone={STATUS_TONE[st]} dot>
                    {STATUS_TEXT[st]}
                  </Badge>
                );
                const href = `/sales/payments/${b.id}`;
                const lines = [...b.lines].sort((x, y) => x.sort - y.sort);
                if (view === "guest" || !lines.length) {
                  const sum = (
                    k: "room_amount" | "safari_amount" | "transfer_amount",
                  ) => lines.reduce((t, l) => t + l[k], 0);
                  return [
                    <tr
                      key={b.id}
                      className="border-t border-sand-200 hover:bg-sand-50"
                    >
                      <td className="tabular px-2 py-2">{dmy(b.check_in)}</td>
                      <td className="tabular px-2 py-2">
                        {dmy(b.check_out)}
                      </td>
                      <td className="px-2 py-2 text-xs text-sand-600">
                        {lines
                          .map((l) => l.booking_no || l.lodge_name)
                          .filter(Boolean)
                          .join(", ") || "-"}
                      </td>
                      <td className="min-w-[150px] px-2 py-2">
                        <Link
                          href={href}
                          className="font-medium text-olive-800 hover:underline"
                        >
                          {b.guest_name}
                        </Link>
                        {b.query_no && (
                          <span className="block text-xs text-sand-500">
                            {b.query_no}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {Math.max(0, ...lines.map((l) => l.rooms)) || "-"}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {lines.reduce((t, l) => t + l.nights, 0) || "-"}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {rupees(sum("room_amount"))}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {sum("safari_amount")
                          ? rupees(sum("safari_amount"))
                          : "-"}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {sum("transfer_amount")
                          ? rupees(sum("transfer_amount"))
                          : "-"}
                      </td>
                      <td className="tabular px-2 py-2 text-right font-medium">
                        {rupees(m.total)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {rupees(m.net)}
                      </td>
                      <td
                        className={`tabular px-2 py-2 text-right font-medium ${m.balance < 0 ? "text-error" : ""}`}
                      >
                        {rupees(m.balance)}
                      </td>
                      <td className="px-2 py-2">
                        {badge}
                        {nd && <span className="tabular mt-0.5 block text-[11px] text-sand-500">due {dmy(nd.due_on)}</span>}
                      </td>
                    </tr>,
                  ];
                }
                const share = byLine(b);
                return lines.map((l, i) => {
                  const sh = share.get(l.id)!;
                    // a cancelled booking owes its charges: its balance on the first row
                    const bal = b.cancelled ? (i === 0 ? m.balance : null) : sh.balance;
                  return (
                    <tr
                      key={l.id}
                      className={`hover:bg-sand-50 ${i === 0 ? "border-t border-sand-200" : ""}`}
                    >
                      <td className="tabular px-2 py-2">{dmy(l.check_in)}</td>
                      <td className="tabular px-2 py-2">
                        {dmy(l.check_out)}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <span className="font-medium text-sand-700">
                          {l.booking_no || "-"}
                        </span>
                        <span className="block text-sand-500">
                          {l.lodge_name}
                        </span>
                      </td>
                      <td className="min-w-[150px] px-2 py-2">
                        <Link
                          href={href}
                          className="font-medium text-olive-800 hover:underline"
                        >
                          {b.guest_name}
                        </Link>
                        {lines.length > 1 && (
                          <span className="block text-xs text-sand-500">
                            {i + 1} of {lines.length} lodges
                          </span>
                        )}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {l.rooms}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {l.nights}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {rupees(l.room_amount)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {l.safari_amount ? rupees(l.safari_amount) : "-"}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {l.transfer_amount ? rupees(l.transfer_amount) : "-"}
                      </td>
                      <td className="tabular px-2 py-2 text-right font-medium">
                        {rupees(sh.total)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {rupees(sh.paid)}
                      </td>
                      <td
                        className={`tabular px-2 py-2 text-right font-medium ${bal !== null && bal < 0 ? "text-error" : ""}`}
                      >
                        {bal === null ? "-" : rupees(bal)}
                      </td>
                      <td className="px-2 py-2">
                        {i === 0 && badge}
                        {i === 0 && nd && <span className="tabular mt-0.5 block text-[11px] text-sand-500">due {dmy(nd.due_on)}</span>}
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-sand-200 px-3 py-2 text-xs text-sand-500">
          Sorted by check-in.{" "}
          {view === "lodge"
            ? "A payment for the whole trip counts against its lodges in order; extra amounts on a booking (markup, flights) show on its page."
            : "One row per guest booking."}
        </p>
      </div>
    </>
  );
}
