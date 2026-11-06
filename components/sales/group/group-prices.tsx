// A group quote's prices for the guest (the tour operator): the selling price per guest for each
// group size, the single room supplement and an extra night. Server or client; no costs shown.
import type { GroupGuest } from "@/lib/sales/group/costing";

const usd = (n: number | null) => (n == null ? "On request" : `US$ ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);

export function GroupPrices({ g, dark = false }: { g: GroupGuest; dark?: boolean }) {
  const muted = dark ? "text-white/65" : "text-sand-500";
  const line = dark ? "border-white/15" : "border-sand-200";
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className={`text-left text-xs uppercase tracking-[0.12em] ${muted}`}>
            <th className="py-2 pr-3 font-medium">Group size</th>
            <th className="py-2 text-right font-medium">Per guest, twin sharing</th>
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r, i) => (
            <tr key={i} className={`border-t ${line}`}>
              <td className="py-2.5 pr-3">
                {r.paying} guests{r.tls ? ` + ${r.tls} tour leader${r.tls === 1 ? "" : "s"} (complimentary)` : ""}
              </td>
              <td className="tabular py-2.5 text-right font-semibold">{usd(r.sell)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={`space-y-1 text-sm ${dark ? "text-white/85" : "text-sand-700"}`}>
        <li>Single room supplement: <b>{usd(g.single_supplement)}</b> per guest</li>
        {g.extra_night && (
          <li>
            Extra night at {g.extra_night.name} (before or after the tour): <b>{usd(g.extra_night.sharing)}</b> per guest sharing, <b>{usd(g.extra_night.single)}</b> single
          </li>
        )}
      </ul>
    </div>
  );
}
