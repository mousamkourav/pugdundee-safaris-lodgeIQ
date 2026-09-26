"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function MonthSelect({
  months,
  selected,
  labels,
}: {
  months: string[]; // YYYY-MM
  selected: string; // YYYY-MM
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function update(v: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("month", v);
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <select
      value={selected}
      onChange={(e) => update(e.target.value)}
      className="min-h-11 rounded-lg border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-sand-700 shadow-card outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 sm:min-h-10"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {labels[m] ?? m}
        </option>
      ))}
    </select>
  );
}
