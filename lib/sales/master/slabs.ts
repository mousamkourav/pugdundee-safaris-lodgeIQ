// Checks the payment schedule and cancellation charges coming from the rates
// Excel import (the browser is not trusted): numbers, sensible ranges, and a
// payment schedule that adds up to 100%.
import type { CancellationRow, PaymentRow } from "./rates-sheet";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const isWhole = (n: number | null): n is number => n !== null && Number.isInteger(n);

export function checkPaymentRows(input: unknown): { rows?: PaymentRow[]; error?: string } {
  if (!Array.isArray(input) || !input.length || input.length > 10) return { error: "Payment schedule: between 1 and 10 rows are needed." };
  const rows = input.map((x) => {
    const p = (x ?? {}) as Record<string, unknown>;
    return { label: String(p.label ?? "Instalment").trim().slice(0, 60) || "Instalment", pct: Number(p.pct), days_before_arrival: num(p.days_before_arrival) };
  });
  for (const r of rows) {
    if (!Number.isFinite(r.pct) || r.pct <= 0 || r.pct > 100) return { error: `Payment schedule: "${r.label}" must be more than 0% and at most 100%.` };
    if (r.days_before_arrival !== null && (!isWhole(r.days_before_arrival) || r.days_before_arrival < 0 || r.days_before_arrival > 730))
      return { error: `Payment schedule: "${r.label}" days before arrival must be a whole number from 0 to 730 (or empty for "at booking").` };
  }
  const total = Math.round(rows.reduce((t, r) => t + r.pct, 0) * 1000) / 1000;
  if (Math.abs(total - 100) > 0.001) return { error: `Payment schedule: the percentages add up to ${total}, not 100.` };
  return { rows };
}

export function checkCancellationRows(input: unknown): { rows?: CancellationRow[]; error?: string } {
  if (!Array.isArray(input) || !input.length || input.length > 20) return { error: "Cancellation charges: between 1 and 20 rows are needed." };
  const rows = input.map((x) => {
    const c = (x ?? {}) as Record<string, unknown>;
    return { min_days: Number(c.min_days), max_days: num(c.max_days), pct: Number(c.pct) };
  });
  for (const r of rows) {
    if (!isWhole(r.min_days) || r.min_days < 0 || r.min_days > 730) return { error: "Cancellation charges: \"from\" days must be a whole number from 0 to 730." };
    if (r.max_days !== null && (!isWhole(r.max_days) || r.max_days < r.min_days || r.max_days > 730))
      return { error: `Cancellation charges: "to" days (${r.max_days}) must be a whole number, not below "from" (${r.min_days}).` };
    if (!Number.isFinite(r.pct) || r.pct < 0 || r.pct > 100) return { error: `Cancellation charges: the charge must be from 0% to 100% (found ${r.pct}%).` };
  }
  return { rows };
}
