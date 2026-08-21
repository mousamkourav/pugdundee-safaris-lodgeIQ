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
      className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {labels[m] ?? m}
        </option>
      ))}
    </select>
  );
}
