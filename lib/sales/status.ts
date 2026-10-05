import type { Tone } from "@/components/ui";

// Must match the CHECK constraint on public.sales_queries.status.
export const QUERY_STATUSES = ["open", "booked", "lost", "cancelled"] as const;
export type QueryStatus = (typeof QUERY_STATUSES)[number];

export const STATUS_LABEL: Record<QueryStatus, string> = {
  open: "Open",
  booked: "Booked",
  lost: "Lost",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<QueryStatus, Tone> = {
  open: "pending",
  booked: "success",
  lost: "neutral",
  cancelled: "error",
};

export const isQueryStatus = (s: unknown): s is QueryStatus =>
  typeof s === "string" && (QUERY_STATUSES as readonly string[]).includes(s);

// Columns used by list views. Keep in one place so pages select the same shape.
export const QUERY_LIST_COLUMNS =
  "id, query_no, status, guest_name, nationality, arrival_date, departure_date, parks, total_amount, booked_amount, lost_reason, assigned_to, created_at, updated_at";

export interface QueryRow {
  id: string;
  query_no: string;
  status: QueryStatus;
  guest_name: string;
  nationality: "indian" | "foreign";
  arrival_date: string | null;
  departure_date: string | null;
  parks: string[];
  total_amount: number | null;
  booked_amount: number | null;
  lost_reason: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}
