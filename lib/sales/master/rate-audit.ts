// =====================================================================
// Rate audit: Master data checked against the owner's documents (rate-card.ts).
// One row per item on a document: OK, missing, a different amount, wrong dates or wrong
// GST. Also every room rate above Rs 7,500 a night without 18% GST. Pure, so it is tested
// without a database; Master data > Rate audit shows it.
// =====================================================================
import { CARD_ADDONS, CARD_LODGES, CARD_ROOMS, CARD_TRANSFER_GST, CARD_TRANSFERS, VEHICLES, type CardTransfer } from "./rate-card";

export interface AuProperty { id: string; name: string; kind: string }
export interface AuLocation { id: string; name: string; type: string; property_id: string | null }
export interface AuRoom { id: string; property_id: string; name: string }
export interface AuRoomRate {
  room_category_id: string; valid_from: string; valid_to: string; meal_plan: string;
  rate_single: number | null; rate_double: number; tax_pct: number; rates_include_tax: boolean; nationality: string; active: boolean;
}
export interface AuTransfer { from_location_id: string; to_location_id: string; vehicle_type: string; rate: number; tax_pct: number; active: boolean }
export interface AuAddon { name: string; property_id: string | null; rate: number; rate_foreign: number | null; tax_pct: number; active: boolean; alias?: boolean }
export interface AuData { properties: AuProperty[]; locations: AuLocation[]; rooms: AuRoom[]; roomRates: AuRoomRate[]; transfers: AuTransfer[]; addons: AuAddon[] }

export type AuditStatus = "ok" | "missing" | "different" | "dates" | "gst" | "not found";
export interface AuditRow {
  source: string;
  item: string;
  expected: string;
  found: string;
  status: AuditStatus;
}

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  ok: "OK",
  missing: "Missing",
  different: "Different amount",
  dates: "Wrong dates",
  gst: "Wrong GST",
  "not found": "Not in Master data",
};

const rs = (n: number | null | undefined) => (n == null ? "-" : `Rs ${Math.round(n).toLocaleString("en-IN")}`);
const low = (s: string) => s.toLowerCase().trim();
const starts = (name: string, want: string) => low(name).replace(/^the\s+/, "").startsWith(low(want).replace(/^the\s+/, ""));

// A place on the card: a lodge (by its park), else an airport, then a railway station, then any place.
function placesFor(d: AuData, name: string): AuLocation[] {
  const lodges = CARD_LODGES[name];
  if (lodges) {
    return lodges.flatMap((l) => {
      const p = d.properties.find((x) => starts(x.name, l));
      const loc = p && d.locations.find((x) => x.property_id === p.id);
      return loc ? [loc] : [];
    });
  }
  const city = low(name.replace(/\b(airport|station|railway station)\b/i, ""));
  const wantStation = /station/i.test(name);
  const rank: Record<string, number> = wantStation ? { railway: 0, airport: 1, city: 2 } : { airport: 0, railway: 1, city: 2 };
  const hits = d.locations.filter((l) => l.type !== "property" && low(l.name).startsWith(city)).sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
  return hits.length ? [hits[0]] : [];
}

const isVehicle = (v: string, kind: keyof typeof VEHICLES) => (kind === "innova" ? /innova|crysta/i : /dzire|etios|sedan/i).test(v);
const onRoad = (t: AuTransfer, a: string, b: string) => (t.from_location_id === a && t.to_location_id === b) || (t.from_location_id === b && t.to_location_id === a);

function auditTransfer(d: AuData, c: CardTransfer): AuditRow[] {
  const source = "Selling-rate card";
  const road = `${c.from} - ${c.to}${c.via ? ` via ${c.via}` : ""}`;
  if (c.via) return [{ source, item: road, expected: `${rs(c.innova)} / ${rs(c.dzire)}`, found: "-", status: "not found" }]; // a question for the owner
  const from = placesFor(d, c.from);
  const to = placesFor(d, c.to);
  if (!from.length || !to.length) {
    const what = !from.length ? c.from : c.to;
    return [{ source, item: road, expected: `${rs(c.innova)} / ${rs(c.dzire)}`, found: `no place "${what}" in Master data`, status: "not found" }];
  }
  const out: AuditRow[] = [];
  for (const a of from) {
    for (const b of to) {
      for (const kind of ["innova", "dzire"] as const) {
        const want = c[kind];
        const item = `${a.name} - ${b.name}, ${VEHICLES[kind]}`;
        const rates = d.transfers.filter((t) => t.active && onRoad(t, a.id, b.id) && isVehicle(t.vehicle_type, kind));
        if (!rates.length) out.push({ source, item, expected: `${rs(want)} + ${CARD_TRANSFER_GST}%`, found: "-", status: "missing" });
        else if (!rates.some((t) => t.rate === want)) out.push({ source, item, expected: rs(want), found: rates.map((t) => rs(t.rate)).join(", "), status: "different" });
        else {
          const t = rates.find((x) => x.rate === want)!;
          out.push({ source, item, expected: `${rs(want)} + ${CARD_TRANSFER_GST}%`, found: `${rs(t.rate)} + ${t.tax_pct}%`, status: t.tax_pct === CARD_TRANSFER_GST ? "ok" : "gst" });
        }
      }
    }
  }
  return out;
}

export function auditRates(d: AuData): AuditRow[] {
  const rows: AuditRow[] = CARD_TRANSFERS.flatMap((c) => auditTransfer(d, c));

  // ---- room rates of the partner hotels
  for (const c of CARD_ROOMS) {
    const item = `${c.hotel}${c.room ? `, ${c.room}` : ""}, ${c.meal}, ${c.on.slice(0, 7)}${c.to ? ` (to ${c.to})` : ""}`;
    const expected = `${rs(c.double)}${c.single ? ` (single ${rs(c.single)})` : ""}${c.tax_included ? " incl. GST" : c.tax_pct ? ` + ${c.tax_pct}%` : ""}`;
    const hotels = d.properties.filter((p) => starts(p.name, c.hotel));
    const rooms = d.rooms.filter((r) => hotels.some((h) => h.id === r.property_id) && (!c.room || starts(r.name, c.room)));
    if (!rooms.length) {
      rows.push({ source: c.source, item, expected, found: hotels.length ? "no room" : "no hotel", status: "not found" });
      continue;
    }
    const rates = d.roomRates.filter((r) => r.active && rooms.some((x) => x.id === r.room_category_id) && r.meal_plan === c.meal && r.valid_from <= c.on && r.valid_to >= c.on);
    if (!rates.length) {
      const other = d.roomRates.filter((r) => r.active && rooms.some((x) => x.id === r.room_category_id) && r.valid_from <= c.on && r.valid_to >= c.on);
      rows.push({ source: c.source, item, expected, found: other.length ? other.map((r) => `${r.meal_plan} ${rs(r.rate_double)} (${r.nationality})`).join(", ") : "-", status: "missing" });
      continue;
    }
    const r = rates.find((x) => x.rate_double === c.double) ?? rates[0];
    const found = `${rs(r.rate_double)}${r.rate_single ? ` (single ${rs(r.rate_single)})` : ""}${r.rates_include_tax ? " incl. GST" : ` + ${r.tax_pct}%`}, ${r.valid_from} to ${r.valid_to}${r.nationality !== "all" ? `, ${r.nationality} only` : ""}`;
    let status: AuditStatus = "ok";
    if (r.rate_double !== c.double || (c.single && r.rate_single !== null && r.rate_single !== c.single)) status = "different";
    else if (c.to && r.valid_to !== c.to) status = "dates";
    else if (c.tax_pct !== undefined && !c.tax_included && (r.rates_include_tax || r.tax_pct !== c.tax_pct)) status = "gst";
    else if (r.nationality !== "all") status = "different"; // a partner hotel's rate is for every guest
    rows.push({ source: c.source, item, expected, found, status });
  }

  // ---- experiences and services
  for (const c of CARD_ADDONS) {
    const hotels = c.hotel ? d.properties.filter((p) => starts(p.name, c.hotel!)) : [];
    const item = `${c.hotel ?? "General"}: ${c.label}`;
    if (c.hotel && !hotels.length) {
      rows.push({ source: c.source, item, expected: rs(c.rate), found: "no hotel", status: "not found" });
      continue;
    }
    const list = d.addons.filter((a) => a.active && !a.alias && c.name.test(a.name) && (c.hotel ? hotels.some((h) => h.id === a.property_id) : !a.property_id));
    if (!list.length) rows.push({ source: c.source, item, expected: rs(c.rate), found: "-", status: "missing" });
    else {
      const a = list.find((x) => x.rate === c.rate || x.rate_foreign === c.rate) ?? list[0];
      rows.push({ source: c.source, item, expected: rs(c.rate), found: `${a.name}: ${rs(a.rate)}${a.rate_foreign != null ? ` (foreign ${rs(a.rate_foreign)})` : ""}`, status: a.rate === c.rate || a.rate_foreign === c.rate ? "ok" : "different" });
    }
  }

  // ---- GST on rooms: above Rs 7,500 a night, 18% (unless the rate includes it)
  for (const r of d.roomRates) {
    if (!r.active || r.rates_include_tax || r.rate_double <= 7500 || r.tax_pct === 18) continue;
    const room = d.rooms.find((x) => x.id === r.room_category_id);
    const hotel = room && d.properties.find((p) => p.id === room.property_id);
    rows.push({ source: "GST rule", item: `${hotel?.name ?? "?"}, ${room?.name ?? "?"}, ${r.meal_plan}, ${r.valid_from} to ${r.valid_to}`, expected: "18% (above Rs 7,500 a night)", found: `${rs(r.rate_double)} + ${r.tax_pct}%`, status: "gst" });
  }
  return rows;
}
