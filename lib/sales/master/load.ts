// Server-only helpers for the master data admin: resolving foreign-key
// dropdowns and formatting list cells. Uses the signed-in user's client,
// so RLS applies (super roles can read and write all sales_* tables).
import { createClient } from "@/lib/supabase/server";
import { rupees, fmtDate } from "@/lib/sales/format";
import type { FieldDef, Option, RefSpec } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pick(row: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, row);
}

export async function loadRefOptions(ref: RefSpec): Promise<Option[]> {
  const supabase = await createClient();
  let q = supabase.from(ref.table).select(ref.select);
  if (ref.filter) q = ref.filter.op === "eq" ? q.eq(ref.filter.column, ref.filter.value) : q.neq(ref.filter.column, ref.filter.value);
  const { data } = await q.order(ref.order).limit(2000);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    value: String(row.id),
    label:
      ref.label
        .map((p) => pick(row, p))
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map(String)
        .join(" - ") || String(row.id),
  }));
}

// Returns the fields with every ref/refs field's options filled in.
export async function withOptions(fields: FieldDef[]): Promise<FieldDef[]> {
  const cache = new Map<string, Promise<Option[]>>();
  return Promise.all(
    fields.map(async (f) => {
      if ((f.type === "ref" || f.type === "refs") && f.ref) {
        const key = JSON.stringify(f.ref);
        if (!cache.has(key)) cache.set(key, loadRefOptions(f.ref));
        return { ...f, options: await cache.get(key)! };
      }
      return f;
    })
  );
}

export function formatCell(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  const label = (v: unknown) => field.options?.find((o) => o.value === String(v))?.label ?? String(v);
  switch (field.type) {
    case "bool":
      return value ? "Yes" : "No";
    case "money":
      return rupees(value as number);
    case "date":
      return fmtDate(String(value));
    case "time":
      return String(value).slice(0, 5);
    case "select":
    case "ref":
      return label(value);
    case "multiselect":
    case "refs":
      return Array.isArray(value) && value.length ? value.map(label).join(", ") : "-";
    case "weekdays":
      return Array.isArray(value) && value.length ? value.map((d) => WEEKDAYS[Number(d)] ?? d).join(", ") : "-";
    case "tags":
      return Array.isArray(value) && value.length ? value.join(", ") : "-";
    case "json":
      return Array.isArray(value) ? `${value.length} item(s)` : "Set";
    default:
      return String(value);
  }
}
