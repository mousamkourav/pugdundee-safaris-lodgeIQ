// Regenerates lib/sales/plan/real-master.data.ts (the owner's real Master data for the tests) from a
// Master data > Rates export (.xlsx).
//
//   npx tsx scripts/real-master-from-export.ts "C:\Users\...\Downloads\Pugdundee rates 2026-11-05.xlsx"
//
// The export holds the rate sheets only. Each row keeps its ID, so:
// - a row already in the test data keeps its links (lodge, room, park, road) and takes every value
//   from the export (read with the same rules as Import rates, fromCell);
// - a new row is linked by the names in its grey columns (park, lodge, rate category);
// - the season calendar and the park closures are rebuilt from the export (they have no links to keep);
// - lodges, rooms, places and parks are not in the export: they are kept as they are.
// A name the test data does not know stops the script (add the place / lodge first).
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { fromCell, plain, type CellIn } from "@/lib/sales/master/rates-sheet";
import { getEntity } from "@/lib/sales/master/entities";
import { REAL_MASTER as OLD } from "@/lib/sales/plan/real-master.data";

type Row = Record<string, unknown>;
const file = process.argv[2];
if (!file) throw new Error("Give the export file: npx tsx scripts/real-master-from-export.ts <file.xlsx>");
const OUT = "lib/sales/plan/real-master.data.ts";

const TABLE: Record<string, keyof typeof OLD> = {
  tariff: "tariff",
  "tariff-calendar": "calendar",
  "room-rates": "roomRates",
  "safari-rates": "safariRates",
  transfers: "transferRates",
  addons: "addons",
  offers: "offers",
  closures: "closures",
};
const REBUILT = new Set(["tariff-calendar", "closures"]); // no IDs to match in the old test data

const old = JSON.parse(JSON.stringify(OLD)) as Record<string, Row[]>;
const byName = (rows: Row[], name: string | null, what: string) => {
  if (name === null || name === "" || name === "null") return null;
  const hit = rows.find((r) => String(r.name).toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`${what} "${name}" is not in the test data: add it to ${OUT} first.`);
  return hit.id as string;
};
const parkId = (n: string | null) => byName(old.parks, n, "Park");
const propertyId = (n: string | null) => byName(old.properties, n, "Lodge / hotel");
const categoryId = (n: string | null) => {
  if (!n) return null;
  const id = `C_${n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
  if (!old.categories.some((c) => c.id === id)) throw new Error(`Rate category "${n}" is not in the test data.`);
  return id;
};
const GREY: Record<string, (label: string | null) => string | null> = { park_id: parkId, property_id: propertyId, rate_category_id: categoryId };

// "children 25%/40% of double", as the lodge exceptions' notes say (free under 5, as the tariff)
function childRates(r: Row): Row[] {
  const m = String(r.notes ?? "").match(/children\s+(\d+)%\s*\/\s*(\d+)%\s+of double/i);
  const dbl = Number(r.rate_double);
  if (!m || !dbl) return (r.child_rates as Row[]) ?? [];
  return [
    { min_age: 0, max_age: 4, rate: 0 },
    { min_age: 5, max_age: 12, rate: Math.round((dbl * Number(m[1])) / 100) },
    { min_age: 13, max_age: 17, rate: Math.round((dbl * Number(m[2])) / 100) },
  ];
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(file) as unknown as ArrayBuffer);
  const meta = wb.getWorksheet("_columns");
  if (!meta) throw new Error("Not a LodgeIQ rates export (no column map).");
  const map = new Map<string, { entity: string; cols: { col: number; kind: string; field: string }[] }>();
  meta.eachRow((r, n) => {
    if (n === 1) return;
    const sheet = String(r.getCell(1).value ?? "");
    const m = map.get(sheet) ?? { entity: String(r.getCell(2).value ?? ""), cols: [] };
    m.cols.push({ col: Number(r.getCell(3).value), kind: String(r.getCell(4).value ?? ""), field: String(r.getCell(5).value ?? "") });
    map.set(sheet, m);
  });

  const next: Record<string, Row[]> = { ...old };
  const report: string[] = [];
  for (const [sheet, m] of map) {
    const key = TABLE[m.entity];
    if (!key) continue;
    const ws = wb.getWorksheet(sheet);
    if (!ws) continue;
    const fields = getEntity(m.entity)?.fields ?? [];
    const idCol = m.cols.find((c) => c.kind === "id")?.col ?? 1;
    const before = new Map((old[key] ?? []).filter((r) => r.id).map((r) => [r.id as string, r]));
    // the keys the tests' rows have (new rows get the same shape)
    const shape = (old[key] ?? [])[0] ?? {};
    const rows: Row[] = [];
    let kept = 0, added = 0;
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const id = String(r.getCell(idCol).value ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(id)) return;
      const was = REBUILT.has(m.entity) ? undefined : before.get(id);
      const row: Row = was ? { ...was } : { ...(REBUILT.has(m.entity) ? {} : { id }) };
      for (const c of m.cols) {
        const raw = r.getCell(c.col).value as CellIn;
        if (c.kind === "edit") {
          const f = fields.find((x) => x.name === c.field);
          if (!f) continue;
          const v = fromCell(f, raw);
          if (v.error) throw new Error(`${sheet} line ${n}: ${v.error}`);
          if (REBUILT.has(m.entity) || c.field in shape || c.field in row) row[c.field] = v.value;
        } else if (c.kind === "grey" && GREY[c.field] && !(m.entity === "offers")) {
          // today's link, from the grey column (a link can change: the picnic became a Pugdundee experience)
          const label = plain(raw);
          row[c.field] = GREY[c.field](label === null ? null : String(label));
        }
      }
      if (m.entity === "room-rates") row.child_rates = childRates(row);
      if (m.entity === "addons") {
        for (const k of Object.keys(shape)) if (!(k in row)) row[k] = null;
        delete row.offered_at;
      }
      rows.push(row);
      if (was) kept++;
      else added++;
    });
    next[key] = rows;
    report.push(`${sheet}: ${rows.length} rows (${kept} kept their links, ${added} new / rebuilt)`);
  }
  // the calendar rows come as the database codes (pugdundee / krl): the categories point at the same codes
  const CAL_CODE: Record<string, string> = { "pugdundee lodges": "pugdundee", "ken river lodge (long weekends)": "krl", "ken river lodge": "krl" };
  next.categories = old.categories.map((c) => ({ ...c, calendar: CAL_CODE[String(c.calendar).toLowerCase()] ?? c.calendar }));
  // "Offered at" (the lodges a Pugdundee experience is sold at) is not in the export. Every general
  // experience the SQL made (picnic lunch, culinary workshop, accompanying naturalist) copied it from the
  // general nature walk (sales_rate_answers_2026-11-03.sql, sales_fixes_2026-11-04.sql): the same here.
  const walkLodges = old.addons.find((a) => a.name === "Nature walk / cycling / night trail" && a.property_id == null)?.offered_at;
  next.addons = next.addons.map((a) => {
    const was = old.addons.find((o) => o.id === a.id);
    if (a.property_id != null) return a;
    // a general experience already in the test data keeps its lodges (none = every lodge)
    if (was && was.property_id == null) return was.offered_at ? { ...a, offered_at: was.offered_at } : a;
    return walkLodges ? { ...a, offered_at: walkLodges } : a;
  });

  const header = `// GENERATED from the owner's Master data export (${file.split(/[\\/]/).pop()}) by
// scripts/real-master-from-export.ts. Do not edit by hand: regenerate from a new export.
// Rate sheets come from the export as they are; lodges, rooms, places and parks are carried over
// (not in the export): the lodges' kind (own: CLAUDE.md's list; Iora Retreat partner; the rest city
// hotels), each city hotel's city, a room's tariff category from its name, "Delhi" / "Agra" / "Jaipur"
// as airports (the owner's missing-roads result). Lodge exceptions' child rates come from their note
// ("children 25%/40% of double"; free under 5 as the tariff). Flight routes are not in the export:
// real-fixture.ts adds the circuit routes the SQL puts in Master data.
export const REAL_MASTER = `;
  writeFileSync(OUT, header + JSON.stringify(next, null, 1) + " as const;\n");
  console.log(report.join("\n"));
  console.log(`Written ${OUT}`);
})();
