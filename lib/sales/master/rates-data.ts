// Server-only: the live master data for the rates workbook, and the comparison
// of an edited workbook with the database (old -> new), used by the import.
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "./entities";
import { withOptions, formatCell } from "./load";
import { RATE_SHEETS, fromCell, isEditable, sameValue, toCell, type CancellationRow, type CellIn, type PaymentRow } from "./rates-sheet";
import type { SheetData, readRatesWorkbook } from "./rates-workbook";
import type { FieldDef } from "./types";

type Row = Record<string, unknown>;

export async function loadRatesData(): Promise<{ sheets: SheetData[]; payment: PaymentRow[]; cancellation: CancellationRow[]; error: string | null }> {
  const supabase = await createClient();
  const sheets: SheetData[] = [];
  let error: string | null = null;
  for (const spec of RATE_SHEETS) {
    const entity = getEntity(spec.entity);
    if (!entity) continue;
    const fields = await withOptions(entity.fields);
    let q = supabase.from(entity.table).select("*");
    if (entity.listFilter) q = entity.listFilter.op === "eq" ? q.eq(entity.listFilter.column, entity.listFilter.value) : q.neq(entity.listFilter.column, entity.listFilter.value);
    for (const o of entity.order) q = q.order(o.column, { ascending: o.ascending, nullsFirst: false });
    const { data, error: e } = await q.limit(5000);
    // a table that does not exist yet (older database) is left empty
    if (e && !/does not exist|schema cache/i.test(e.message)) error ??= `${spec.sheet}: ${e.message}`;
    sheets.push({ sheet: spec.sheet, entity: spec.entity, fields, rows: sortRows(spec.entity, (data ?? []) as Row[], fields) });
  }
  const { data: s } = await supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle();
  const settings = ((s as { data?: Row } | null)?.data ?? {}) as Row;
  return { sheets, ...settingsLists(settings), error };
}

// Rows in a reading order: by what identifies them (lodge, park, category), then dates.
function sortRows(entityKey: string, rows: Row[], fields: FieldDef[]): Row[] {
  const label = (f: FieldDef | undefined, r: Row) => (f ? String(toCell(f, r[f.name]) ?? "") : "");
  const keyFields: Record<string, string[]> = {
    tariff: ["rate_category_id", "nationality", "valid_from", "season"],
    "tariff-calendar": ["calendar", "date_from"],
    "room-rates": ["room_category_id", "valid_from"],
    "safari-rates": ["park_id", "nationality", "zone", "session", "valid_from"],
    transfers: ["from_location_id", "to_location_id", "vehicle_type"],
    addons: ["name"],
    offers: ["name"],
    closures: ["park_id", "closure_type", "date_from"],
  };
  const by = (keyFields[entityKey] ?? []).map((n) => fields.find((f) => f.name === n));
  return [...rows].sort((a, b) => {
    for (const f of by) {
      if (!f) continue;
      const x = f.type === "date" ? String(a[f.name] ?? "") : label(f, a);
      const y = f.type === "date" ? String(b[f.name] ?? "") : label(f, b);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}

function settingsLists(s: Row): { payment: PaymentRow[]; cancellation: CancellationRow[] } {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const payment = (Array.isArray(s.payment_slabs) ? s.payment_slabs : []).map((p: Row) => ({ label: String(p.label ?? ""), pct: Number(p.pct ?? 0), days_before_arrival: n(p.days_before_arrival) }));
  const cancellation = (Array.isArray(s.cancellation_slabs) ? s.cancellation_slabs : []).map((c: Row) => ({ min_days: Number(c.min_days ?? 0), max_days: n(c.max_days), pct: Number(c.pct ?? 0) }));
  return { payment, cancellation };
}

// ---------------------------------------------------------------- the comparison

export interface RateChange {
  sheet: string;
  entity: string;
  id: string;
  row: string; // what the row is, e.g. "Cottage - Foreign nationals - High"
  field: string;
  label: string;
  old: unknown;
  new: unknown;
  oldText: string;
  newText: string;
}

export interface ImportPreview {
  changes: RateChange[];
  problems: string[]; // cells that could not be read (not applied)
  notes: string[]; // e.g. new rows that were ignored
  payment?: { old: PaymentRow[]; new: PaymentRow[] } | null;
  cancellation?: { old: CancellationRow[]; new: CancellationRow[] } | null;
}

const show = (f: FieldDef, v: unknown) => (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? "(empty)" : formatCell(f, v));

export async function compareWorkbook(read: Awaited<ReturnType<typeof readRatesWorkbook>>): Promise<ImportPreview> {
  const supabase = await createClient();
  const out: ImportPreview = { changes: [], problems: [], notes: [] };

  for (const rs of read.sheets) {
    const entity = getEntity(rs.entity);
    if (!entity || !RATE_SHEETS.some((s) => s.entity === rs.entity)) continue;
    if (rs.newRows) out.notes.push(`${rs.sheet}: ${rs.newRows} row${rs.newRows === 1 ? "" : "s"} without an ID ${rs.newRows === 1 ? "was" : "were"} not imported. Add new items in Master data.`);
    if (!rs.rows.length) continue;
    const fields = await withOptions(entity.fields);
    const byName = new Map(fields.map((f) => [f.name, f]));
    const ids = rs.rows.map((r) => r.id);
    const current = new Map<string, Row>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from(entity.table).select("*").in("id", ids.slice(i, i + 300));
      for (const r of (data ?? []) as Row[]) current.set(String(r.id), r);
    }
    const describeRow = (r: Row) =>
      entity.list
        .slice(0, 4)
        .map((n) => byName.get(n))
        .filter((f): f is FieldDef => !!f && f.name !== "active")
        .map((f) => show(f, r[f.name]))
        .filter((x) => x !== "(empty)")
        .join(" - ");

    for (const row of rs.rows) {
      const db = current.get(row.id);
      if (!db) {
        out.problems.push(`${rs.sheet}, row ${row.line}: this item no longer exists in LodgeIQ (deleted since the export).`);
        continue;
      }
      for (const [name, cell] of Object.entries(row.cells)) {
        const f = byName.get(name);
        if (!f || !isEditable(f)) continue;
        const parsed = fromCell(f, cell as CellIn);
        if (parsed.error) {
          out.problems.push(`${rs.sheet}, row ${row.line}: ${parsed.error}`);
          continue;
        }
        if (sameValue(f, db[name], parsed.value)) continue;
        out.changes.push({ sheet: rs.sheet, entity: rs.entity, id: row.id, row: describeRow(db), field: name, label: f.label, old: db[name] ?? null, new: parsed.value, oldText: show(f, db[name]), newText: show(f, parsed.value) });
      }
    }
  }

  // payment & cancellation lists
  const { data: s } = await supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle();
  const now = settingsLists(((s as { data?: Row } | null)?.data ?? {}) as Row);
  const num = (c: CellIn, what: string, line: number, allowEmpty: boolean): number | null | undefined => {
    const r = fromCell({ name: "x", label: what, type: "number" }, c);
    if (r.error) {
      out.problems.push(`Payment & cancellation, ${what} (${line}): ${r.error.replace(/^[^:]+: /, "")}`);
      return undefined;
    }
    if (r.value === null && !allowEmpty) {
      out.problems.push(`Payment & cancellation, ${what} (${line}) is empty.`);
      return undefined;
    }
    return r.value as number | null;
  };
  if (read.payment) {
    const rows: PaymentRow[] = [];
    let ok = true;
    read.payment.forEach((p, i) => {
      const label = String((p.label as string | null) ?? "").trim();
      if (!label && (p.pct === null || p.pct === undefined || p.pct === "")) return;
      const pct = num(p.pct, "instalment %", i + 1, false);
      const days = num(p.days, "instalment days", i + 1, true);
      if (pct === undefined || days === undefined) return void (ok = false);
      rows.push({ label: label || "Instalment", pct: pct!, days_before_arrival: days });
    });
    const total = rows.reduce((t, r) => t + r.pct, 0);
    if (ok && rows.length && Math.abs(total - 100) > 0.001) out.problems.push(`Payment schedule: the percentages add up to ${total}, not 100. It was not changed.`);
    else if (ok && rows.length && JSON.stringify(rows) !== JSON.stringify(now.payment)) out.payment = { old: now.payment, new: rows };
  }
  if (read.cancellation) {
    const rows: CancellationRow[] = [];
    let ok = true;
    read.cancellation.forEach((c, i) => {
      if ([c.from, c.to, c.pct].every((x) => x === null || x === undefined || x === "")) return;
      const from = num(c.from, "cancellation from", i + 1, false);
      const to = num(c.to, "cancellation to", i + 1, true);
      const pct = num(c.pct, "cancellation %", i + 1, false);
      if (from === undefined || to === undefined || pct === undefined) return void (ok = false);
      rows.push({ min_days: from!, max_days: to, pct: pct! });
    });
    if (ok && rows.length && JSON.stringify(rows) !== JSON.stringify(now.cancellation)) out.cancellation = { old: now.cancellation, new: rows };
  }
  return out;
}
