"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  function update(value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("month", value);
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <div className="mb-6">
      <input
        type="month"
        value={month}
        onChange={(e) => update(e.target.value)}
        className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
      />
    </div>
  );
}
