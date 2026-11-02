"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ui } from "@/components/ui";
import { RANGE_KEYS, RANGE_LABEL, rangeHref, type RangeKey } from "@/lib/sales/dashboard-range";

// Period dropdown for the Sales dashboard. The choice lives in the URL (?range=...),
// so it stays while the user moves around and can be bookmarked or shared.
export function RangePicker({ value, fromDay, toDay }: { value: RangeKey; fromDay: string | null; toDay: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [key, setKey] = useState<RangeKey>(value);
  const [from, setFrom] = useState(fromDay ?? "");
  const [to, setTo] = useState(toDay ?? "");

  function go(k: RangeKey, f = from, t = to) {
    router.push(rangeHref(pathname, { key: k, fromDay: f || null, toDay: t || null }));
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label className="sr-only" htmlFor="sales-range">Period</label>
      <select
        id="sales-range"
        value={key}
        onChange={(e) => {
          const k = e.target.value as RangeKey;
          setKey(k);
          if (k !== "custom") go(k);
        }}
        className="min-h-11 w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-sand-700 shadow-card outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 sm:min-h-10 sm:w-auto"
      >
        {RANGE_KEYS.map((k) => (
          <option key={k} value={k}>
            {RANGE_LABEL[k]}
            {k === "all" ? " (default)" : ""}
          </option>
        ))}
      </select>
      {key === "custom" && (
        <form
          className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            go("custom");
          }}
        >
          <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={`${ui.inputSm} min-w-0 flex-1 sm:w-40 sm:flex-none`} />
          <span className="text-sm text-sand-500">to</span>
          <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={`${ui.inputSm} min-w-0 flex-1 sm:w-40 sm:flex-none`} />
          <button className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={!from && !to}>Apply</button>
        </form>
      )}
    </div>
  );
}
