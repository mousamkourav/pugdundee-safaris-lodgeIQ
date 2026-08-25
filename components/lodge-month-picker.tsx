"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { LodgeLite } from "@/lib/lodges";
import { lodgeSlug } from "@/lib/lodge-slug";

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

  const nowY = new Date().getFullYear();
  const years: number[] = [];
  for (let y = nowY + 1; y >= 2024; y--) years.push(y);

  // Current lodge as a slug for the URL (falls back to the raw value).
  const current = lodges.find((l) => l.id === lodge);
  const currentSlug = current ? lodgeSlug(current.name) : (lodge ?? "");

  function go(nextLodgeSlug: string, nextYear: number, nextMon: number) {
    const params = new URLSearchParams(sp.toString());
    if (nextLodgeSlug) params.set("lodge", nextLodgeSlug);
    params.set("month", `${nextYear}-${String(nextMon).padStart(2, "0")}`);
    router.push(`${pathname}?${params.toString()}`);
    router.refresh(); // ensure the server component re-queries for the new params
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <select
        value={currentSlug}
        onChange={(e) => go(e.target.value, year, mon)}
        className={selCls}
      >
        {lodges.map((l) => (
          <option key={l.id} value={lodgeSlug(l.name)}>
            {l.name}
          </option>
        ))}
      </select>

      <select
        value={mon}
        onChange={(e) => go(currentSlug, year, Number(e.target.value))}
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
        onChange={(e) => go(currentSlug, Number(e.target.value), mon)}
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
