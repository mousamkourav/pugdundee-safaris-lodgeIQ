"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { LodgeLite } from "@/lib/lodges";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const selCls =
  "rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500";

export function LodgeMonthPicker({
  lodges,
  lodge,
  month, // "YYYY-MM"
}: {
  lodges: LodgeLite[];
  lodge: string | null;
  month: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [yStr, mStr] = month.split("-");
  const year = Number(yStr) || new Date().getFullYear();
  const mon = Number(mStr) || 1;

  // Year range: a few years back through next year, so any report is reachable.
  const nowY = new Date().getFullYear();
  const years: number[] = [];
  for (let y = nowY + 1; y >= 2024; y--) years.push(y);

  function setMonth(newYear: number, newMon: number) {
    const params = new URLSearchParams(sp.toString());
    params.set("month", `${newYear}-${String(newMon).padStart(2, "0")}`);
    router.push(`${pathname}?${params.toString()}`);
  }
  function setLodge(value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("lodge", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <select
        value={lodge ?? ""}
        onChange={(e) => setLodge(e.target.value)}
        className={selCls}
      >
        {lodges.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>

      <select
        value={mon}
        onChange={(e) => setMonth(year, Number(e.target.value))}
        className={selCls}
      >
        {MONTHS.map((label, i) => (
          <option key={label} value={i + 1}>
            {label}
          </option>
        ))}
      </select>

      <select
        value={year}
        onChange={(e) => setMonth(Number(e.target.value), mon)}
        className={selCls}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
