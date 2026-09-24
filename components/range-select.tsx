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

// split "YYYY-MM" -> { y, m } (strings, may be empty)
function parseYM(ym: string): { y: string; m: string } {
  const [y, m] = (ym || "").split("-");
  return { y: y || "", m: m || "" };
}
function makeYM(y: string, m: string): string {
  if (!y || !m) return "";
  return `${y}-${m.padStart(2, "0")}`;
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

  const [draftFrom, setDraftFrom] = useState(from ?? "");
  const [draftTo, setDraftTo] = useState(to ?? "");

  useEffect(() => {
    setDraftFrom(from ?? "");
    setDraftTo(to ?? "");
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

  function applyCustom(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo) return;
    if (nextFrom === (from ?? "") && nextTo === (to ?? "")) return;
    push((p) => {
      p.set("range", "custom");
      p.set("from", nextFrom);
      p.set("to", nextTo);
    });
  }

  const isCustom = preset === "custom";
  const fromP = parseYM(draftFrom);
  const toP = parseYM(draftTo);

  const resolvedLabel =
    isCustom && draftFrom && draftTo
      ? draftFrom <= draftTo
        ? `${ymLabel(draftFrom)} - ${ymLabel(draftTo)}`
        : `${ymLabel(draftTo)} - ${ymLabel(draftFrom)}`
      : null;

  function setFromPart(part: "y" | "m", val: string) {
    const next = part === "y" ? makeYM(val, fromP.m) : makeYM(fromP.y, val);
    setDraftFrom(next);
    applyCustom(next, draftTo);
  }
  function setToPart(part: "y" | "m", val: string) {
    const next = part === "y" ? makeYM(val, toP.m) : makeYM(toP.y, val);
    setDraftTo(next);
    applyCustom(draftFrom, next);
  }

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
                  value={fromP.m}
                  onChange={(e) => setFromPart("m", e.target.value)}
                  disabled={pending}
                  className={controlCls}
                >
                  <option value="">Month</option>
                  {MONTHS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>{label}</option>
                  ))}
                </select>
                <select
                  value={fromP.y}
                  onChange={(e) => setFromPart("y", e.target.value)}
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
                  value={toP.m}
                  onChange={(e) => setToPart("m", e.target.value)}
                  disabled={pending}
                  className={controlCls}
                >
                  <option value="">Month</option>
                  {MONTHS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>{label}</option>
                  ))}
                </select>
                <select
                  value={toP.y}
                  onChange={(e) => setToPart("y", e.target.value)}
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
