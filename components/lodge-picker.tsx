"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { LodgeLite } from "@/lib/lodges";
import { lodgeSlug } from "@/lib/lodge-slug";

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

  const current = lodges.find((l) => l.id === lodge);
  const currentSlug = current ? lodgeSlug(current.name) : (lodge ?? "");

  function update(value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("lodge", value);
    router.push(`${pathname}?${params.toString()}`);
    router.refresh();
  }

  return (
    <div className="mb-6">
      <select
        value={currentSlug}
        onChange={(e) => update(e.target.value)}
        className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
      >
        {lodges.map((l) => (
          <option key={l.id} value={lodgeSlug(l.name)}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
