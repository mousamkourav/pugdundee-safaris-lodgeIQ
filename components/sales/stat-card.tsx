import type { ReactNode } from "react";
import { ui } from "@/components/ui";

export function StatCard({
  label,
  value,
  hint,
  highlight = false,
  valueClass = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  highlight?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-xl border border-gold-200 bg-gold-50 p-4 shadow-card"
          : `${ui.card} p-4`
      }
    >
      <p className={"eyebrow " + (highlight ? "!text-gold-800" : "")}>{label}</p>
      <p className={`tabular mt-1 font-display text-2xl font-semibold text-olive-800 ${valueClass}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-sand-500">{hint}</p>}
    </div>
  );
}
