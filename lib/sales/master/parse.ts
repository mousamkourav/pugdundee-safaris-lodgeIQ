// Turns submitted FormData into a database row, following the field config.
// Runs on the server inside the save action.
import type { FieldDef } from "./types";

export function parseRow(
  fields: FieldDef[],
  fd: FormData
): { row: Record<string, unknown>; error?: string } {
  const row: Record<string, unknown> = {};

  for (const f of fields) {
    const raw = fd.get(f.name);
    const s = typeof raw === "string" ? raw.trim() : "";
    let v: unknown = null;

    switch (f.type) {
      case "bool":
        v = raw === "on" || raw === "true";
        break;
      case "int": {
        if (s !== "") {
          const n = Number(s);
          if (!Number.isInteger(n)) return { row, error: `${f.label} must be a whole number.` };
          v = n;
        }
        break;
      }
      case "number":
      case "money": {
        if (s !== "") {
          const n = Number(s);
          if (!Number.isFinite(n)) return { row, error: `${f.label} must be a number.` };
          if (f.type === "money" && n < 0) return { row, error: `${f.label} cannot be negative.` };
          v = n;
        }
        break;
      }
      case "tags":
        v = s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        break;
      case "multiselect":
      case "refs":
        v = fd.getAll(f.name).map(String).filter(Boolean);
        break;
      case "weekdays":
        v = fd
          .getAll(f.name)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
          .sort((a, b) => a - b);
        break;
      case "json": {
        if (s !== "") {
          try {
            v = JSON.parse(s);
          } catch {
            return { row, error: `${f.label} is not valid JSON. Check brackets, quotes and commas.` };
          }
        }
        break;
      }
      case "select":
        v = s === "" ? null : f.asNumber ? Number(s) : s;
        break;
      default: // text, textarea, ref, date, time
        v = s === "" ? null : s;
    }

    const isEmpty = v === null || (Array.isArray(v) && v.length === 0 && f.empty !== undefined);
    if (isEmpty && f.empty !== undefined) v = f.empty;
    if (f.required && (v === null || (Array.isArray(v) && v.length === 0))) {
      return { row, error: `${f.label} is required.` };
    }
    row[f.name] = v;
  }
  return { row };
}
