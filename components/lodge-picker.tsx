"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { LodgeLite } from "@/lib/lodges";

export function LodgePicker({
  lodges,
  lodge,
}: {
  lodges: LodgeLite[];
  lodge: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function update(value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("lodge", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="mb-6">
      <select
        value={lodge ?? ""}
        onChange={(e) => update(e.target.value)}
        className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
      >
        {lodges.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
