"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { COL_GROUPS, activeGroups } from "@/lib/columns";

export function ColumnToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const active = activeGroups(sp.get("cols") ?? undefined);

  function toggle(key: string, locked?: boolean) {
    if (locked) return;
    const next = new Set(active);
    if (next.has(key as never)) next.delete(key as never);
    else next.add(key as never);
    // drop "core" from the URL (it's implicit/always on) to keep it short
    next.delete("core" as never);
    const params = new URLSearchParams(sp.toString());
    if (next.size === 0) params.delete("cols");
    else params.set("cols", Array.from(next).join(","));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-sand-400">Columns:</span>
      {COL_GROUPS.map((g) => {
        const on = active.has(g.key);
        return (
          <button
            key={g.key}
            type="button"
            onClick={() => toggle(g.key, g.locked)}
            aria-pressed={on}
            className={
              "rounded-full border px-3 py-1 text-xs transition " +
              (on
                ? "border-olive-600 bg-olive-50 text-olive-800"
                : "border-sand-200 text-sand-500 hover:bg-sand-50") +
              (g.locked ? " cursor-default opacity-70" : "")
            }
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}
