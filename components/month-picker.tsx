"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const selCls =
  "min-h-11 rounded-lg border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-sand-700 shadow-card outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 sm:min-h-10";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [yStr, mStr] = month.split("-");
  const year = Number(yStr) || new Date().getFullYear();
  const mon = Number(mStr) || 1;
  const nowY = new Date().getFullYear();
  const years: number[] = [];
  for (let y = nowY + 1; y >= 2024; y--) years.push(y);

  function set(newYear: number, newMon: number) {
    const params = new URLSearchParams(sp.toString());
    params.set("month", `${newYear}-${String(newMon).padStart(2, "0")}`);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <select value={mon} onChange={(e) => set(year, Number(e.target.value))} className={selCls}>
        {MONTHS.map((label, i) => (
          <option key={label} value={i + 1}>{label}</option>
        ))}
      </select>
      <select value={year} onChange={(e) => set(Number(e.target.value), mon)} className={selCls}>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}
