"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { LodgeLite } from "@/lib/lodges";

export function LodgeMonthPicker({
  lodges,
  lodge,
  month,
}: {
  lodges: LodgeLite[];
  lodge: string | null;
  month: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <select
        value={lodge ?? ""}
        onChange={(e) => update("lodge", e.target.value)}
        className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
      >
        {lodges.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <input
        type="month"
        value={month}
        onChange={(e) => update("month", e.target.value)}
        className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
      />
    </div>
  );
}
