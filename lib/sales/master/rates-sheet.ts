// The "all rates" workbook: which master data goes on which sheet, which
// columns can be edited, and how a cell turns back into a database value.
// Pure functions (no database, no Excel library): shared by the export route,
// the import and the tests.

import { getEntity } from "./entities";
import type { FieldDef, Option } from "./types";

export type ColumnKind = "id" | "edit" | "grey" | "gst";

export interface SheetColumn {
  kind: ColumnKind;
  header: string;
  field?: string; // database column (id / edit / grey)
  of?: string; // gst: the rate column this is worked out from
  width: number;
}

export interface SheetSpec {
  sheet: string; // Excel sheet name
  entity: string; // entity key in entities.ts
  intro: string; // one line under the title on the Read me sheet
}

// Sheets, in workbook order (Read me first, Payment & cancellation last).
export const RATE_SHEETS: SheetSpec[] = [
  { sheet: "Room tariff", entity: "tariff", intro: "One rate for every lodge's rooms of a category, by nationality and season." },
  { sheet: "Season calendar", entity: "tariff-calendar", intro: "Which dates are Shoulder, High and Peak (long weekends are Peak)." },
  { sheet: "Lodge exceptions", entity: "room-rates", intro: "A rate that differs from the tariff at one lodge. Normally empty." },
  { sheet: "Safari rates", entity: "safari-rates", intro: "Per jeep (or per seat), by park, zone, session and nationality." },
  { sheet: "Transfers", entity: "transfers", intro: "One way per vehicle; most rates are the same for the return trip." },
  { sheet: "Add-ons & experiences", entity: "addons", intro: "Experiences and extras, with Indian and foreign prices." },
  { sheet: "Offers", entity: "offers", intro: "Early bird, % off, stay-pay and multi-lodge offers." },
  { sheet: "Park closures", entity: "closures", intro: "Weekly closures and closed dates (festivals, monsoon)." },
];
export const PAYMENT_SHEET = "Payment & cancellation";

// Rate columns that get an "incl. GST" column next to them.
const GST_FIELDS: Record<string, string[]> = {
  tariff: ["rate_double", "rate_single", "weekend_rate_double", "weekend_rate_single"],
  "room-rates": ["rate_double", "rate_single", "extra_adult", "weekend_rate_double", "weekend_rate_single"],
  "safari-rates": ["weekday_rate", "weekend_rate", "naturalist_fee"],
  transfers: ["rate"],
  addons: ["rate", "rate_foreign", "extra_guest_rate", "extra_guest_rate_foreign"],
};

// Columns kept off the sheet: internal, or not useful for a rate review.
const SKIP: Record<string, string[]> = {
  "room-rates": ["season_id", "cost_double", "compulsory_supplement", "child_rates"],
};

// Types that are edited in the sheet; the rest (references, lists, JSON) only identify the row.
const EDITABLE = new Set(["text", "textarea", "int", "number", "money", "date", "time", "bool", "select", "weekdays"]);
export const isEditable = (f: FieldDef) => EDITABLE.has(f.type);

const WIDTH: Partial<Record<FieldDef["type"], number>> = { textarea: 60, text: 24, ref: 30, refs: 30, multiselect: 20, date: 13, money: 13, number: 11, int: 9, bool: 8, weekdays: 14, select: 20, json: 20 };

export function sheetColumns(entityKey: string, fields: FieldDef[]): SheetColumn[] {
  const skip = new Set(SKIP[entityKey] ?? []);
  const gst = new Set(GST_FIELDS[entityKey] ?? []);
  const cols: SheetColumn[] = [{ kind: "id", header: "ID (do not change)", field: "id", width: 38 }];
  // what identifies the row first (lodge, park, category...), then the editable columns
  const shown = fields.filter((f) => !skip.has(f.name));
  for (const f of [...shown.filter((x) => !isEditable(x)), ...shown.filter(isEditable)]) {
    cols.push({ kind: isEditable(f) ? "edit" : "grey", header: f.label, field: f.name, width: WIDTH[f.type] ?? 14 });
    if (gst.has(f.name) && fields.some((x) => x.name === "tax_pct")) cols.push({ kind: "gst", header: `${f.label} incl. GST`, of: f.name, width: 14 });
  }
  return cols;
}

// ---------------------------------------------------------------- values -> cells

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const labelOf = (opts: Option[] | undefined, v: unknown) => opts?.find((o) => o.value === String(v))?.label ?? String(v);

// What goes in the cell for a database value (dates as real dates, bools as Yes / No).
export function toCell(f: FieldDef, v: unknown): string | number | Date | null {
  if (v === null || v === undefined || v === "") return f.type === "bool" ? "No" : null;
  switch (f.type) {
    case "bool":
      return v ? "Yes" : "No";
    case "int":
    case "number":
    case "money":
      return Number(v);
    case "date": {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
    }
    case "time":
      return String(v).slice(0, 5);
    case "select":
    case "ref":
      return labelOf(f.options, v);
    case "weekdays":
      return Array.isArray(v) && v.length ? v.map((d) => DAYS[Number(d)] ?? String(d)).join(", ") : null;
    case "refs":
    case "multiselect":
    case "tags":
      return Array.isArray(v) && v.length ? v.map((x) => labelOf(f.options, x)).join(", ") : null;
    case "json":
      return JSON.stringify(v);
    default:
      return String(v);
  }
}

// ---------------------------------------------------------------- cells -> values

export type CellIn = string | number | boolean | Date | null | undefined | { text?: string; result?: unknown; richText?: { text: string }[] };

// Plain value of an Excel cell (rich text, formulas and hyperlinks flattened).
export function plain(c: CellIn): string | number | boolean | Date | null {
  if (c === null || c === undefined) return null;
  if (c instanceof Date || typeof c !== "object") return c;
  if (Array.isArray(c.richText)) return c.richText.map((r) => r.text).join("");
  if ("result" in c) return (c.result ?? null) as string | number | null;
  if (typeof c.text === "string") return c.text;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toISODate(c: string | number | boolean | Date): string | null {
  if (c instanceof Date) return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  if (typeof c === "number") {
    // an Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(c).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/ .](\d{1,2}|[A-Za-z]{3,9})[-/ .](\d{4})$/); // 05-01-2027, 5 Jan 2027, 05-Jan-2027
  if (m) {
    const mon = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon >= 1 && mon <= 12) return `${m[3]}-${pad(mon)}-${pad(+m[1])}`;
  }
  return null;
}

// A cell back to a database value, following the same rules as the Master data form.
export function fromCell(f: FieldDef, raw: CellIn): { value?: unknown; error?: string } {
  const c = plain(raw);
  const empty = c === null || (typeof c === "string" && c.trim() === "");
  const s = empty ? "" : typeof c === "string" ? c.trim() : c;
  let v: unknown = null;
  if (!empty) {
    switch (f.type) {
      case "bool": {
        const t = String(s).toLowerCase();
        if (s === true || ["yes", "y", "true", "1"].includes(t)) v = true;
        else if (s === false || ["no", "n", "false", "0"].includes(t)) v = false;
        else return { error: `${f.label}: write Yes or No.` };
        break;
      }
      case "int":
      case "number":
      case "money": {
        const n = typeof s === "number" ? s : Number(String(s).replace(/[,\s]/g, "").replace(/^(rs\.?|inr|\u20b9)/i, ""));
        if (!Number.isFinite(n)) return { error: `${f.label}: "${s}" is not a number.` };
        if (f.type === "int" && !Number.isInteger(n)) return { error: `${f.label}: must be a whole number.` };
        if (f.type === "money" && n < 0) return { error: `${f.label}: cannot be negative.` };
        v = f.type === "money" ? Math.round(n * 100) / 100 : n;
        break;
      }
      case "date": {
        const d = toISODate(s as string | number | Date);
        if (!d) return { error: `${f.label}: "${s}" is not a date (use dd-mm-yyyy).` };
        v = d;
        break;
      }
      case "time": {
        const t = typeof s === "number" ? `${pad(Math.floor(s * 24))}:${pad(Math.round((s * 1440) % 60))}` : String(s);
        if (!/^\d{1,2}:\d{2}$/.test(t)) return { error: `${f.label}: use hh:mm.` };
        v = t.padStart(5, "0");
        break;
      }
      case "select": {
        const t = String(s).trim().toLowerCase();
        const o = f.options?.find((x) => x.label.toLowerCase() === t || x.value.toLowerCase() === t);
        if (!o) return { error: `${f.label}: "${s}" is not one of ${(f.options ?? []).map((x) => x.label).join(", ")}.` };
        v = f.asNumber ? Number(o.value) : o.value;
        break;
      }
      case "weekdays": {
        const parts = String(s).split(/[,;\s]+/).filter(Boolean);
        const days: number[] = [];
        for (const p of parts) {
          const i = DAYS.findIndex((d) => d.toLowerCase() === p.slice(0, 3).toLowerCase());
          if (i < 0) return { error: `${f.label}: "${p}" is not a day (use Sun, Mon, Tue...).` };
          if (!days.includes(i)) days.push(i);
        }
        v = days.sort((a, b) => a - b);
        break;
      }
      default:
        v = String(s);
    }
  } else if (f.type === "weekdays") v = [];
  else if (f.type === "bool") v = false;

  if ((v === null || (Array.isArray(v) && !v.length)) && f.empty !== undefined) v = f.empty;
  if (f.required && (v === null || v === "")) return { error: `${f.label} is required.` };
  return { value: v };
}

// Same value? (numbers by amount, dates by day, lists by content)
export function sameValue(f: FieldDef, a: unknown, b: unknown): boolean {
  const norm = (x: unknown): unknown => {
    if (x === undefined || x === "") return null;
    if (["int", "number", "money"].includes(f.type)) return x === null ? null : Math.round(Number(x) * 100) / 100;
    if (f.type === "date") return x === null ? null : String(x).slice(0, 10);
    if (f.type === "time") return x === null ? null : String(x).slice(0, 5);
    if (f.type === "bool") return !!x;
    if (f.type === "weekdays") return JSON.stringify(Array.isArray(x) ? [...x].map(Number).sort((p, q) => p - q) : []);
    if (f.type === "select") return x === null ? null : String(x);
    return x === null ? null : String(x).trim();
  };
  return norm(a) === norm(b);
}

export const entityFor = (sheet: string) => {
  const spec = RATE_SHEETS.find((s) => s.sheet === sheet);
  return spec ? getEntity(spec.entity) ?? null : null;
};

// ---------------------------------------------------------------- payment & cancellation

export interface PaymentRow {
  label: string;
  pct: number;
  days_before_arrival: number | null;
}
export interface CancellationRow {
  min_days: number;
  max_days: number | null;
  pct: number;
}
