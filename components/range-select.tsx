"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { RANGE_PRESETS, ymLabel } from "@/lib/ranges";

const controlCls =
  "rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-sand-800 outline-none transition focus:border-olive-600 focus:ring-2 focus:ring-gold-500 disabled:opacity-60";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function partsOf(ym: string): { y: string; m: string } {
  const [y, m] = (ym || "").split("-");
  return { y: y || "", m: m || "" };
}

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
  const [pending, startTransition] = useTransition();

  // Store month and year parts INDEPENDENTLY so a half-selection holds.
  const initFrom = partsOf(from ?? "");
  const initTo = partsOf(to ?? "");
  const [fromM, setFromM] = useState(initFrom.m);
  const [fromY, setFromY] = useState(initFrom.y);
  const [toM, setToM] = useState(initTo.m);
  const [toY, setToY] = useState(initTo.y);

  useEffect(() => {
    const f = partsOf(from ?? "");
    const t = partsOf(to ?? "");
    setFromM(f.m); setFromY(f.y);
    setToM(t.m); setToY(t.y);
  }, [from, to]);

  const nowYear = new Date().getFullYear();
  const years: string[] = [];
  for (let y = nowYear + 1; y >= 2024; y--) years.push(String(y));

  function push(mut: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(sp.toString());
    mut(params);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function onPreset(value: string) {
    push((p) => {
      p.set("range", value);
      if (value !== "custom") {
        p.delete("from");
        p.delete("to");
      }
    });
  }

  // Apply only when BOTH ends are fully chosen (month + year on each side).
  function apply(fM: string, fY: string, tM: string, tY: string) {
    if (!fM || !fY || !tM || !tY) return;
    const nextFrom = `${fY}-${fM.padStart(2, "0")}`;
    const nextTo = `${tY}-${tM.padStart(2, "0")}`;
    if (nextFrom === (from ?? "") && nextTo === (to ?? "")) return;
    push((p) => {
      p.set("range", "custom");
      p.set("from", nextFrom);
      p.set("to", nextTo);
    });
  }

  const isCustom = preset === "custom";

  function fromComplete() { return fromM && fromY; }
  function toComplete() { return toM && toY; }
  const resolvedLabel =
    isCustom && fromComplete() && toComplete()
      ? `${ymLabel(`${fromY}-${fromM.padStart(2, "0")}`)} - ${ymLabel(`${toY}-${toM.padStart(2, "0")}`)}`
      : null;

  return (
    <div
      className={
        "flex w-full flex-col gap-2 transition-opacity sm:w-auto " +
        (pending ? "opacity-60" : "")
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sand-500">Period</span>
          <select
            value={preset}
            onChange={(e) => onPreset(e.target.value)}
            disabled={pending}
            className={controlCls}
          >
            {RANGE_PRESETS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        {isCustom && (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-sand-500">From</span>
              <div className="flex gap-2">
                <select
                  value={fromM}
                  onChange={(e) => { const v = e.target.value; setFromM(v); apply(v, fromY, toM, toY); }}
                  disabled={pending}
                  className={controlCls}
                >
                  <option value="">Month</option>
                  {MONTHS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>{label}</option>
                  ))}
                </select>
                <select
                  value={fromY}
                  onChange={(e) => { const v = e.target.value; setFromY(v); apply(fromM, v, toM, toY); }}
                  disabled={pending}
                  className={controlCls}
                >
                  <option value="">Year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-sand-500">To</span>
              <div className="flex gap-2">
                <select
                  value={toM}
                  onChange={(e) => { const v = e.target.value; setToM(v); apply(fromM, fromY, v, toY); }}
                  disabled={pending}
                  className={controlCls}
                >
                  <option value="">Month</option>
                  {MONTHS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>{label}</option>
                  ))}
                </select>
                <select
                  value={toY}
                  onChange={(e) => { const v = e.target.value; setToY(v); apply(fromM, fromY, toM, v); }}
                  disabled={pending}
                  className={controlCls}
                >
                  <option value="">Year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      {isCustom && (
        <p className="text-xs text-sand-500" aria-live="polite">
          {resolvedLabel
            ? `Showing ${resolvedLabel}`
            : "Pick a start and end month to apply the range."}
        </p>
      )}
    </div>
  );
}
