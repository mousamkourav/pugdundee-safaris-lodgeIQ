"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { RANGE_PRESETS } from "@/lib/ranges";

const selCls =
  "rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500";

export function RangeSelect({
  preset,
  from,
  to,
}: {
  preset: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function apply(mut: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mut(params);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={preset}
        onChange={(e) =>
          apply((p) => {
            p.set("range", e.target.value);
            if (e.target.value !== "custom") {
              p.delete("from");
              p.delete("to");
            }
          })
        }
        className={selCls}
      >
        {RANGE_PRESETS.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>

      {preset === "custom" && (
        <>
          <input
            type="month"
            value={from ?? ""}
            onChange={(e) =>
              apply((p) => {
                p.set("range", "custom");
                p.set("from", e.target.value);
              })
            }
            className={selCls}
          />
          <span className="text-sm text-sand-400">to</span>
          <input
            type="month"
            value={to ?? ""}
            onChange={(e) =>
              apply((p) => {
                p.set("range", "custom");
                p.set("to", e.target.value);
              })
            }
            className={selCls}
          />
        </>
      )}
    </div>
  );
}
