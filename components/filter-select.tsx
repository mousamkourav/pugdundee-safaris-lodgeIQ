"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export type FilterOption = { value: string; label: string };

// URL-driven filter dropdown. The first option is always "All" (empty value),
// which removes the query param, so the default view is genuinely unfiltered.
export function FilterSelect({
  param,
  value,
  options,
  allLabel,
  ariaLabel,
}: {
  param: string;
  value: string | null;
  options: FilterOption[];
  allLabel: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function update(v: string) {
    const params = new URLSearchParams(sp.toString());
    if (v) params.set(param, v);
    else params.delete(param);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => update(e.target.value)}
      aria-label={ariaLabel ?? allLabel}
      className="min-h-11 rounded-lg border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-sand-700 shadow-card outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 sm:min-h-10"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
