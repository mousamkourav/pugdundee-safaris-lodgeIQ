// Sales dashboard numbers, from the queries of the chosen period. Pure, tested.
import type { QueryRow } from "./status";

export interface Totals {
  draft: number;
  created: number; // every query except drafts
  open: number;
  quoted: number;
  booked: number;
  lost: number;
  cancelled: number;
  bookedValue: number; // trip totals of the booked quotes
  received: number; // money received when they were marked booked
  pendingValue: number; // trip totals of open + quoted
}

type Row = Pick<QueryRow, "status" | "total_amount" | "booked_amount">;

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function summarise(rows: Row[]): Totals {
  const t: Totals = { draft: 0, created: 0, open: 0, quoted: 0, booked: 0, lost: 0, cancelled: 0, bookedValue: 0, received: 0, pendingValue: 0 };
  for (const r of rows) {
    // Drafts have not been quoted yet: counted on their own, not in created or conversion.
    if (r.status === "draft") {
      t.draft += 1;
      continue;
    }
    if (!(r.status in t)) continue; // an unknown status never breaks the totals
    t.created += 1;
    t[r.status] += 1;
    if (r.status === "booked") {
      t.bookedValue += money(r.total_amount);
      t.received += money(r.booked_amount);
    }
    if (r.status === "open" || r.status === "quoted") t.pendingValue += money(r.total_amount);
  }
  return t;
}

export const conversion = (t: Pick<Totals, "booked" | "created">) => (t.created > 0 ? Math.round((t.booked / t.created) * 100) : 0);

// The follow-up list: open and quoted queries of the period, newest first.
export function followUps<T extends Pick<QueryRow, "status" | "created_at">>(rows: T[], limit = 50) {
  return rows
    .filter((r) => r.status === "open" || r.status === "quoted")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit);
}

// Per-member totals (admin view). Active members with no query in the period are listed with zeros.
export function byMember<T extends Row & Pick<QueryRow, "assigned_to">>(
  rows: T[],
  members: { id: string; status?: string | null }[],
  names: Record<string, string>,
) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.assigned_to) continue;
    map.set(r.assigned_to, [...(map.get(r.assigned_to) ?? []), r]);
  }
  for (const m of members) if (m.status !== "disabled" && !map.has(m.id)) map.set(m.id, []);
  return [...map.entries()]
    .map(([id, rs]) => ({ id, name: names[id] ?? "Unknown", t: summarise(rs) }))
    .sort((a, b) => b.t.bookedValue - a.t.bookedValue || b.t.created - a.t.created);
}
