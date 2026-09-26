// Design-system primitives (see design-reference DESIGN.md). Class-string
// constants for places that need a raw className (forms, links), plus a few
// tiny presentational components. Server- and client-safe: no hooks here.

import type { ReactNode } from "react";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export const ui = {
  // Buttons: 40px tall on desktop, 44px on touch (min-h-11 below sm).
  btnPrimary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-olive-700 active:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 ${focusRing}`,
  btnSecondary: `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-700 transition hover:border-sand-500 hover:bg-sand-100 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 ${focusRing}`,
  btnGhost: `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-olive-600 transition hover:bg-sand-100 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 ${focusRing}`,
  btnDanger: `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 ${focusRing}`,
  btnDangerOutline: `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-error-border bg-white px-4 py-2 text-sm font-medium text-error transition hover:bg-error-bg disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 ${focusRing}`,
  btnSm: "min-h-9 px-3 py-1.5 text-xs sm:min-h-8",

  input:
    "w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100 disabled:text-sand-500",
  inputSm:
    "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100 disabled:text-sand-500",
  select:
    "rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm font-medium text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100",
  label: "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-sand-500",

  card: "rounded-xl border border-sand-200 bg-white shadow-card",
  cardHover: "transition hover:shadow-card-hover",
  muted: "rounded-xl border border-sand-200 bg-sand-100",
  empty:
    "rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-sand-500",
  alertError: "rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error",
  alertSuccess: "rounded-lg border border-success-border bg-success-bg px-3 py-2 text-sm text-success",
  alertWarning: "rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning",
};

export type Tone =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "pending"
  | "neutral"
  | "olive"
  | "gold";

export const TONE: Record<Tone, string> = {
  success: "border-success-border bg-success-bg text-success",
  warning: "border-warning-border bg-warning-bg text-warning",
  error: "border-error-border bg-error-bg text-error",
  info: "border-info-border bg-info-bg text-info",
  pending: "border-pending-border bg-pending-bg text-warning",
  neutral: "border-sand-200 bg-sand-100 text-sand-600",
  olive: "border-olive-200 bg-olive-50 text-olive-700",
  gold: "border-gold-200 bg-gold-50 text-gold-800",
};

export const TONE_DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
  pending: "bg-pending",
  neutral: "bg-sand-400",
  olive: "bg-olive-600",
  gold: "bg-gold-500",
};

// Capsule status/priority pill with an optional 6px status dot.
export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}
    >
      {dot && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

// Section title with the 4px olive left accent; action sits on the far edge.
export function SectionHeader({
  title,
  description,
  action,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}
    >
      <div className="min-w-0 border-l-4 border-olive-600 pl-3">
        <h2 className="text-lg leading-6 sm:text-xl">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-sand-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
