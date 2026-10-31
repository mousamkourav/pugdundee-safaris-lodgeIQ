// =====================================================================
// Rate audit: Master data checked against the owner's documents (rate-card.ts).
// One row per item on a document: OK, missing, a different amount, wrong dates or wrong
// GST. Also every room rate above Rs 7,500 a night without 18% GST. Pure, so it is tested
// without a database; Master data > Rate audit shows it.
// =====================================================================
import {
  CARD_ADDONS,
  CARD_CALENDAR,
  CARD_KRL_ROOMS,
  CARD_LODGES,
  CARD_PLACES,
  CARD_ROOMS,
  CARD_SAFARIS,
  CARD_TARIFF,
  CARD_TRANSFER_GST,
  CARD_TRANSFERS,
  CARD_VIA,
  TARIFF_FROM,
  TARIFF_TO,
  VEHICLES,
  type CardTransfer,
} from "./rate-card";

export interface AuProperty { id: string; name: string; kind: string; park_id?: string | null }
export interface AuLocation { id: string; name: string; type: string; property_id: string | null }
export interface AuRoom { id: string; property_id: string; name: string; rate_category_id?: string | null }
export interface AuRoomRate {
  room_category_id: string; valid_from: string; valid_to: string; meal_plan: string;
  rate_single: number | null; rate_double: number; tax_pct: number; rates_include_tax: boolean; nationality: string; active: boolean;
  weekend_rate_double?: number | null;
}
export interface AuTransfer { from_location_id: string; to_location_id: string; vehicle_type: string; rate: number; tax_pct: number; active: boolean }
export interface AuAddon {
  name: string; property_id: string | null; rate: number; rate_foreign: number | null; tax_pct: number; active: boolean; alias?: boolean;
  pricing_unit?: string; min_guests?: number | null; included_guests?: number | null; extra_guest_rate?: number | null; extra_guest_rate_foreign?: number | null;
  tiers?: { max_guests: number; rate: number }[] | null; tiers_foreign?: { max_guests: number; rate: number }[] | null;
}
export interface AuPark { id: string; name: string }
export interface AuSafari {
  park_id: string; zone: string; session: string; vehicle_type: string; nationality: string; valid_from: string; valid_to: string;
  weekday_rate: number; weekend_rate: number | null; naturalist_fee: number; tax_pct: number; active: boolean;
  book_min_days?: number | null; book_max_days?: number | null;
}
export interface AuTariff {
  rate_category_id: string; nationality: string; season: string; valid_from: string; valid_to: string;
  rate_single: number | null; rate_double: number; weekend_rate_double?: number | null; meal_plan: string; tax_pct: number; rates_include_tax: boolean; active: boolean;
}
export interface AuCategory { id: string; name: string; calendar?: string }
export interface AuCalendar { calendar: string; season: string; date_from: string; date_to: string; active: boolean }
export interface AuData {
  properties: AuProperty[];
  locations: AuLocation[];
  rooms: AuRoom[];
  roomRates: AuRoomRate[];
  transfers: AuTransfer[];
  addons: AuAddon[];
  parks?: AuPark[];
  safaris?: AuSafari[];
  tariff?: AuTariff[];
  categories?: AuCategory[];
  calendar?: AuCalendar[];
}

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
const squash = (s: string) => low(s).replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const starts = (name: string, want: string) => squash(name).startsWith(squash(want));
const gstText = (pct: number) => (pct ? ` + ${pct}%` : " incl. GST");

// The places a name on the card stands for: the lodges of a park; the airport and / or
// station of a town (CARD_PLACES); else one place by its name (airport, station, any).
export function placesFor(d: AuData, name: string): AuLocation[] {
  const lodges = CARD_LODGES[name];
  if (lodges) {
    return lodges.flatMap((l) => {
      const p = d.properties.find((x) => starts(x.name, l));
      const loc = p && d.locations.find((x) => x.property_id === p.id);
      return loc ? [loc] : [];
    });
  }
  const rule = CARD_PLACES[name] ?? { names: [name.replace(/\s+(airport|station)$/i, "")], types: ["any" as const] };
  const named = d.locations.filter((l) => l.type !== "property" && rule.names.some((n) => starts(l.name, n)));
  const out: AuLocation[] = [];
  for (const type of rule.types) {
    const rank: Record<string, number> = { airport: 0, railway: 1, city: 2 };
    const hit = type === "any" ? [...named].sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9))[0] : named.find((l) => l.type === type);
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

const isVehicle = (v: string, kind: keyof typeof VEHICLES) => (kind === "innova" ? /innova|crysta/i : /dzire|etios|sedan/i).test(v);
const onRoad = (t: AuTransfer, a: string, b: string) => (t.from_location_id === a && t.to_location_id === b) || (t.from_location_id === b && t.to_location_id === a);

function auditTransfer(d: AuData, c: CardTransfer): AuditRow[] {
  const source = c.source ?? "Selling-rate card";
  const road = `${c.from} - ${c.to}`;
  if (c.via) return []; // checked as the via add-on (auditVia)
  const from = placesFor(d, c.from);
  const to = placesFor(d, c.to);
  const expectedAll = `${rs(c.innova)}${c.dzire != null ? ` / ${rs(c.dzire)}` : ""}`;
  if (!from.length || !to.length) {
    const what = !from.length ? c.from : c.to;
    return [{ source, item: road, expected: expectedAll, found: `no place "${what}" in Master data`, status: "not found" }];
  }
  const out: AuditRow[] = [];
  for (const a of from) {
    for (const b of to) {
      for (const kind of ["innova", "dzire"] as const) {
        const want = c[kind];
        if (want == null) continue;
        const item = `${a.name} - ${b.name}, ${VEHICLES[kind]}`;
        const rates = d.transfers.filter((t) => t.active && onRoad(t, a.id, b.id) && isVehicle(t.vehicle_type, kind));
        if (!rates.length) out.push({ source, item, expected: `${rs(want)} + ${CARD_TRANSFER_GST}%`, found: "-", status: "missing" });
        else if (!rates.some((t) => t.rate === want)) out.push({ source, item, expected: rs(want), found: rates.map((t) => rs(t.rate)).join(", "), status: "different" });
        else {
          const t = rates.find((x) => x.rate === want)!;
          out.push({ source, item, expected: `${rs(want)} + ${CARD_TRANSFER_GST}%`, found: `${rs(t.rate)}${gstText(t.tax_pct)}`, status: t.tax_pct === CARD_TRANSFER_GST ? "ok" : "gst" });
        }
      }
    }
  }
  return out;
}

// A road "via" a place: an add-on at each lodge, the extra per vehicle.
function auditVia(d: AuData): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const v of CARD_VIA) {
    for (const lodge of v.lodges) {
      const p = d.properties.find((x) => starts(x.name, lodge));
      const item = `${lodge}: ${v.name}`;
      const expected = `${rs(v.innova)} + ${CARD_TRANSFER_GST}%`;
      if (!p) {
        rows.push({ source: "Selling-rate card", item, expected, found: "no lodge", status: "not found" });
        continue;
      }
      const a = d.addons.find((x) => x.active && !x.alias && x.property_id === p.id && new RegExp(`via\\s+${v.via}`, "i").test(x.name));
      if (!a) rows.push({ source: "Selling-rate card", item, expected, found: "-", status: "missing" });
      else rows.push({ source: "Selling-rate card", item, expected, found: `${rs(a.rate)}${gstText(a.tax_pct)}`, status: a.rate !== v.innova ? "different" : a.tax_pct !== CARD_TRANSFER_GST ? "gst" : "ok" });
    }
  }
  return rows;
}

function auditRooms(d: AuData): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const c of CARD_ROOMS) {
    const item = `${c.hotel}${c.room ? `, ${c.room}` : ""}, ${c.meal}, ${c.on.slice(0, 7)}${c.to ? ` (to ${c.to})` : ""}`;
    const expected = `${rs(c.double)}${c.single ? ` (single ${rs(c.single)})` : ""}${c.tax_included ? " incl. GST" : c.tax_pct ? ` + ${c.tax_pct}%` : ""}`;
    const hotels = d.properties.filter((p) => starts(p.name, c.hotel) || squash(p.name).includes(squash(c.hotel)));
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
  return rows;
}

// The Pugdundee tariff: each category, nationality and season, valid for 2026-27; + the calendar.
function auditTariff(d: AuData): AuditRow[] {
  const source = "Tariff 2026-27";
  const rows: AuditRow[] = [];
  const tariff = d.tariff ?? [];
  for (const c of CARD_TARIFF) {
    const who = c.nationality === "indian" ? "Indian (published)" : `foreign, ${c.season}`;
    const item = `${c.category}, ${who}`;
    const expected = `${rs(c.double)} (single ${rs(c.single)}) + 18%`;
    const cat = (d.categories ?? []).find((x) => squash(x.name) === squash(c.category)) ?? (d.categories ?? []).find((x) => starts(x.name, c.category));
    if (!cat) {
      rows.push({ source, item, expected, found: "no tariff category", status: "not found" });
      continue;
    }
    const mine = tariff.filter((t) => t.active && t.rate_category_id === cat.id && t.nationality === c.nationality && t.season === c.season && t.valid_from <= TARIFF_TO && t.valid_to >= TARIFF_FROM);
    if (!mine.length) {
      rows.push({ source, item, expected, found: "-", status: "missing" });
      continue;
    }
    const t = mine.find((x) => x.rate_double === c.double) ?? mine[0];
    const found = `${rs(t.rate_double)} (single ${rs(t.rate_single)})${t.rates_include_tax ? " incl. GST" : ` + ${t.tax_pct}%`}, ${t.valid_from} to ${t.valid_to}`;
    let status: AuditStatus = "ok";
    if (t.rate_double !== c.double || t.rate_single !== c.single) status = "different";
    else if (t.valid_from > TARIFF_FROM || t.valid_to < TARIFF_TO) status = "dates";
    else if (t.rates_include_tax || t.tax_pct !== 18) status = "gst";
    else if (t.meal_plan !== "AP") status = "different";
    rows.push({ source, item, expected, found, status });
  }
  // the season calendar: each range with its season (long weekends are extra Peak rows)
  const cal = (d.calendar ?? []).filter((x) => x.active && (x.calendar || "pugdundee") === "pugdundee");
  for (const r of CARD_CALENDAR) {
    const item = `Season calendar: ${r.from} to ${r.to}`;
    const exact = cal.find((x) => x.date_from === r.from && x.date_to === r.to && x.season === r.season);
    if (exact) {
      rows.push({ source, item, expected: r.season, found: r.season, status: "ok" });
      continue;
    }
    const overlap = cal.filter((x) => x.date_from <= r.to && x.date_to >= r.from && x.season !== "peak");
    rows.push({ source, item, expected: r.season, found: overlap.length ? overlap.map((x) => `${x.season} ${x.date_from} to ${x.date_to}`).join(", ") : "-", status: overlap.length ? "dates" : "missing" });
  }
  return rows;
}

// Ken River Lodge rooms (B2B, taxes included): the lodge's own room rates, or its tariff category.
function auditKrlRooms(d: AuData): AuditRow[] {
  const source = "Ken River Lodge B2B";
  const krl = d.properties.find((p) => starts(p.name, "Ken River"));
  const on = "2026-12-15"; // a weekday rate period, not a long weekend
  return CARD_KRL_ROOMS.map((c) => {
    const item = `Ken River Lodge: ${c.label}`;
    const expected = `${rs(c.weekday)} / ${rs(c.weekend)} / ${rs(c.long)} incl. GST`;
    const room = krl && d.rooms.find((r) => r.property_id === krl.id && c.room.test(r.name));
    if (!room) return { source, item, expected, found: krl ? "no such room" : "no lodge", status: "not found" as const };
    const own = d.roomRates.filter((r) => r.active && r.room_category_id === room.id && r.valid_from <= on && r.valid_to >= on);
    const cat = room.rate_category_id ? (d.tariff ?? []).filter((t) => t.active && t.rate_category_id === room.rate_category_id && t.season !== "peak" && t.valid_from <= on && t.valid_to >= on) : [];
    const list = [...own.map((r) => ({ double: r.rate_double, weekend: r.weekend_rate_double ?? null, incl: r.rates_include_tax || r.tax_pct === 0 })), ...cat.map((t) => ({ double: t.rate_double, weekend: t.weekend_rate_double ?? null, incl: t.rates_include_tax || t.tax_pct === 0 }))];
    if (!list.length) return { source, item, expected, found: "-", status: "missing" as const };
    const r = list.find((x) => x.double === c.weekday) ?? list[0];
    const found = `${rs(r.double)} / ${rs(r.weekend)}${r.incl ? " incl. GST" : " + GST"}`;
    const status: AuditStatus = r.double !== c.weekday || (r.weekend !== null && r.weekend !== c.weekend) ? "different" : !r.incl ? "gst" : "ok";
    return { source, item, expected, found: r.double === c.published ? `${found} (the published tariff)` : found, status };
  });
}

// Jeep safaris: each park, zone, nationality (and booking window), morning and evening.
function auditSafaris(d: AuData): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const c of CARD_SAFARIS) {
    const park = (d.parks ?? []).find((p) => starts(p.name, c.park));
    const label = `${c.park} ${c.zone}${c.nationality === "foreign" ? ", foreign" : ""}${c.book ? `, booked ${c.book[0]}-${c.book[1]} days ahead` : ""}`;
    const expected = `${rs(c.weekday)} / ${rs(c.weekend)}, naturalist ${c.naturalist ? rs(c.naturalist) : "included"}${gstText(c.tax_pct)}`;
    if (!park) {
      rows.push({ source: c.source, item: label, expected, found: "no park", status: "not found" });
      continue;
    }
    for (const session of ["morning", "afternoon"]) {
      const item = `${label}, ${session === "afternoon" ? "evening" : "morning"}`;
      const list = (d.safaris ?? []).filter(
        (s) =>
          s.active && s.park_id === park.id && s.zone === c.zone && s.session === session && /exclusive|jeep/i.test(s.vehicle_type) &&
          (s.nationality === c.nationality || s.nationality === "all" || c.nationality === "all") && s.valid_from <= c.on && s.valid_to >= c.on &&
          (!c.book || ((s.book_min_days ?? 0) === c.book[0] && (s.book_max_days ?? 0) === c.book[1]))
      );
      if (!list.length) {
        rows.push({ source: c.source, item, expected, found: "-", status: "missing" });
        continue;
      }
      const s = list.find((x) => x.nationality === c.nationality) ?? list[0];
      const weekend = s.weekend_rate ?? s.weekday_rate;
      const found = `${rs(s.weekday_rate)} / ${rs(weekend)}, naturalist ${s.naturalist_fee ? rs(s.naturalist_fee) : "included"}${gstText(s.tax_pct)}${s.nationality !== c.nationality ? ` (${s.nationality} guests)` : ""}`;
      const status: AuditStatus = s.weekday_rate !== c.weekday || weekend !== c.weekend || s.naturalist_fee !== c.naturalist ? "different" : s.tax_pct !== c.tax_pct ? "gst" : "ok";
      rows.push({ source: c.source, item, expected, found, status });
    }
  }
  return rows;
}

function auditAddons(d: AuData): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const c of CARD_ADDONS) {
    const hotels = c.hotel ? d.properties.filter((p) => starts(p.name, c.hotel!) || squash(p.name).includes(squash(c.hotel!))) : [];
    const item = `${c.hotel ?? "General"}: ${c.label}`;
    const expected = `${rs(c.rate)}${c.tax_pct !== undefined ? gstText(c.tax_pct) : ""}${c.tiers ? ` (${c.tiers.map((t) => `${t.max_guests} guests ${rs(t.rate)}`).join(", ")})` : ""}${c.extra ? `, + ${rs(c.extra)} per guest over ${c.included}` : ""}`;
    if (c.hotel && !hotels.length) {
      rows.push({ source: c.source, item, expected, found: "no hotel", status: "not found" });
      continue;
    }
    // a general activity can also be kept at each lodge
    const list = d.addons.filter((a) => a.active && !a.alias && c.name.test(a.name) && (c.hotel ? hotels.some((h) => h.id === a.property_id) : true));
    if (!list.length) {
      rows.push({ source: c.source, item, expected, found: "-", status: "missing" });
      continue;
    }
    const price = (a: AuAddon) => (c.foreign && a.rate_foreign != null ? a.rate_foreign : a.rate);
    const tiersOf = (a: AuAddon) => (c.foreign ? a.tiers_foreign ?? a.tiers : a.tiers) ?? [];
    const sameTiers = (a: AuAddon) => !c.tiers || c.tiers.every((t) => tiersOf(a).some((x) => x.max_guests === t.max_guests && x.rate === t.rate));
    const extraOf = (a: AuAddon) => (c.foreign ? a.extra_guest_rate_foreign ?? a.extra_guest_rate : a.extra_guest_rate);
    for (const a of c.hotel ? list.slice(0, 1) : list) {
      const where = c.hotel ? "" : ` at ${d.properties.find((p) => p.id === a.property_id)?.name ?? "all lodges"}`;
      const found = `${a.name}${where}: ${rs(price(a))}${gstText(a.tax_pct)}${tiersOf(a).length ? ` (${tiersOf(a).map((t) => `${t.max_guests}: ${rs(t.rate)}`).join(", ")})` : ""}`;
      const amountOk = c.tiers ? sameTiers(a) : price(a) === c.rate;
      const extraOk = !c.extra || (extraOf(a) === c.extra && (a.included_guests ?? null) === c.included);
      const status: AuditStatus = !amountOk || !extraOk ? "different" : c.tax_pct !== undefined && a.tax_pct !== c.tax_pct ? "gst" : "ok";
      rows.push({ source: c.source, item: item + where, expected, found, status });
    }
  }
  return rows;
}

export function auditRates(d: AuData): AuditRow[] {
  const rows: AuditRow[] = [...CARD_TRANSFERS.flatMap((c) => auditTransfer(d, c)), ...auditVia(d), ...auditRooms(d), ...auditTariff(d), ...auditKrlRooms(d), ...auditSafaris(d), ...auditAddons(d)];
  // ---- GST on rooms: above Rs 7,500 a night, 18% (unless the rate includes it)
  for (const r of d.roomRates) {
    if (!r.active || r.rates_include_tax || r.rate_double <= 7500 || r.tax_pct === 18) continue;
    const room = d.rooms.find((x) => x.id === r.room_category_id);
    const hotel = room && d.properties.find((p) => p.id === room.property_id);
    rows.push({ source: "GST rule", item: `${hotel?.name ?? "?"}, ${room?.name ?? "?"}, ${r.meal_plan}, ${r.valid_from} to ${r.valid_to}`, expected: "18% (above Rs 7,500 a night)", found: `${rs(r.rate_double)} + ${r.tax_pct}%`, status: "gst" });
  }
  return rows;
}
