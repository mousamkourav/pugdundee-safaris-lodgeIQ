// Run with:  npx tsx --test lib/sales/master/rate-audit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRates, type AuData, type AuRoomRate } from "./rate-audit";
import { CARD_SAFARIS, CARD_TRANSFERS, RATE_CARD_QUESTIONS } from "./rate-card";

const rr = (room: string, o: Partial<AuRoomRate>): AuRoomRate => ({
  room_category_id: room, valid_from: "2026-04-01", valid_to: "2027-03-31", meal_plan: "CP", rate_single: null, rate_double: 0,
  tax_pct: 18, rates_include_tax: false, nationality: "all", active: true, ...o,
});
const t = (from: string, to: string, vehicle_type: string, rate: number, tax_pct = 5) => ({ from_location_id: from, to_location_id: to, vehicle_type, rate, tax_pct, active: true });

const data: AuData = {
  properties: [
    { id: "KEL", name: "Kanha Earth Lodge", kind: "own_lodge" },
    { id: "KL", name: "Kings Lodge", kind: "own_lodge" },
    { id: "THH", name: "Tree House Hideaway", kind: "own_lodge" },
    { id: "ROS", name: "Roseate House", kind: "city_hotel" },
    { id: "RAD", name: "Radisson Hotel Jass Khajuraho", kind: "city_hotel" },
  ],
  locations: [
    { id: "L_KEL", name: "Kanha Earth Lodge", type: "property", property_id: "KEL" },
    { id: "L_KL", name: "Kings Lodge", type: "property", property_id: "KL" },
    { id: "L_THH", name: "Tree House Hideaway", type: "property", property_id: "THH" },
    { id: "JBP", name: "Jabalpur Railway Station", type: "railway", property_id: null },
    { id: "JLR", name: "Jabalpur Airport", type: "airport", property_id: null },
  ],
  rooms: [{ id: "ROS_D", property_id: "ROS", name: "AC Deluxe" }, { id: "RAD_R", property_id: "RAD", name: "Deluxe" }],
  roomRates: [
    rr("ROS_D", { rate_double: 23000 }),
    rr("ROS_D", { valid_from: "2027-04-01", valid_to: "2027-09-30", rate_double: 17000, nationality: "indian" }),
    rr("RAD_R", { valid_to: "2027-09-30", rate_double: 15000, tax_pct: 12 }),
  ],
  transfers: [
    t("L_KEL", "JLR", "Innova / Crysta", 9000),
    t("JLR", "L_KEL", "Dzire / Etios", 7000),
    t("L_KL", "JLR", "Innova / Crysta", 9000, 0),
  ],
  addons: [
    { name: "Khajuraho sightseeing (per vehicle)", property_id: "RAD", rate: 6000, rate_foreign: null, tax_pct: 5, active: true },
    { name: "Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)", property_id: "KEL", rate: 1500, rate_foreign: null, tax_pct: 5, active: true },
  ],
};
const rows = auditRates(data);
const row = (source: string, item: string) => rows.find((r) => r.source === source && r.item === item);

test("the selling-rate card has 33 roads", () => {
  assert.equal(CARD_TRANSFERS.filter((c) => !c.source).length, 33);
});

test("transfers: OK, a different amount, missing, wrong GST; Jabalpur is its airport; Bandhavgarh is both lodges", () => {
  assert.equal(row("Selling-rate card", "Kanha Earth Lodge - Jabalpur Airport, Innova / Crysta")?.status, "ok");
  const dz = row("Selling-rate card", "Kanha Earth Lodge - Jabalpur Airport, Dzire / Etios");
  assert.equal(dz?.status, "different");
  assert.equal(dz?.found, "Rs 7,000");
  assert.equal(row("Selling-rate card", "Kings Lodge - Jabalpur Airport, Innova / Crysta")?.status, "gst");
  assert.equal(row("Selling-rate card", "Tree House Hideaway - Jabalpur Airport, Innova / Crysta")?.status, "missing");
  // a park with no lodge in this data: not in Master data
  assert.equal(rows.find((r) => r.item === "Satpura - Bhopal")?.status, "not found");
  // Jabalpur: the airport and the railway station of the city, the same rate
  assert.equal(row("Selling-rate card", "Kanha Earth Lodge - Jabalpur Railway Station, Innova / Crysta")?.status, "missing");
  // a road "via" a place is an add-on at the lodge, the extra per vehicle
  assert.equal(row("Selling-rate card", "Kanha Earth Lodge: Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)")?.status, "ok");
  assert.equal(row("Selling-rate card", "Kings Lodge: Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)")?.status, "missing");
  assert.ok(!rows.some((r) => / via /.test(r.item) && !/Transfer via/.test(r.item)));
});

test("partner hotel rooms: Roseate 23,000 OK; 17,000 saved for Indian guests only is flagged; Radisson GST", () => {
  assert.equal(rows.find((r) => r.item.startsWith("Roseate House, CP, 2027-03"))?.status, "ok");
  const apr = rows.find((r) => r.item.startsWith("Roseate House, CP, 2027-05"));
  assert.equal(apr?.status, "different");
  assert.match(apr!.found, /indian only/);
  assert.equal(rows.find((r) => r.source === "GST rule" && r.item.startsWith("Radisson"))?.found, "Rs 15,000 + 12%");
});

test("experiences: found and checked, or missing", () => {
  assert.equal(row("Partner hotels", "Radisson: Khajuraho sightseeing")?.status, "ok");
  assert.equal(row("Partner hotels", "Radisson: Khajuraho guide")?.status, "missing");
  assert.equal(row("Partner hotels", "Iora: Camera fee")?.status, "not found");
});

test("what the documents leave open is a question for the owner", () => {
  assert.ok(RATE_CARD_QUESTIONS.some((q) => /Bhimbetka/.test(q)));
  assert.ok(RATE_CARD_QUESTIONS.some((q) => /whole 2026-27 season/.test(q)));
});

// ---- the tariff, the season calendar, safaris and Ken River Lodge
const full: AuData = {
  ...data,
  properties: [...data.properties, { id: "KRL", name: "Ken River Lodge", kind: "own_lodge" }],
  rooms: [...data.rooms, { id: "KRL_S", property_id: "KRL", name: "Stilted River Facing Cottage" }, { id: "KRL_H", property_id: "KRL", name: "AC Premium Hut", rate_category_id: "CAT_HUT" }],
  roomRates: [
    ...data.roomRates,
    rr("KRL_S", { meal_plan: "AP", valid_from: "2026-10-01", valid_to: "2027-09-30", rate_double: 16500, weekend_rate_double: 17500, tax_pct: 0, rates_include_tax: true }),
    rr("KRL_S", { meal_plan: "AP", valid_from: "2026-12-21", valid_to: "2027-01-04", rate_double: 18500, tax_pct: 0, rates_include_tax: true }),
  ],
  categories: [{ id: "CAT_C", name: "Cottage" }, { id: "CAT_T", name: "Treehouse" }, { id: "CAT_HUT", name: "KRL Premium Hut", calendar: "krl" }],
  tariff: [
    { rate_category_id: "CAT_C", nationality: "foreign", season: "shoulder", valid_from: "2026-10-01", valid_to: "2027-09-30", rate_single: 15000, rate_double: 18000, meal_plan: "AP", tax_pct: 18, rates_include_tax: false, active: true },
    { rate_category_id: "CAT_C", nationality: "foreign", season: "high", valid_from: "2026-10-01", valid_to: "2027-09-30", rate_single: 18500, rate_double: 21000, meal_plan: "AP", tax_pct: 18, rates_include_tax: false, active: true },
    { rate_category_id: "CAT_C", nationality: "indian", season: "all", valid_from: "2026-10-01", valid_to: "2027-03-31", rate_single: 27000, rate_double: 30000, meal_plan: "AP", tax_pct: 18, rates_include_tax: false, active: true },
    { rate_category_id: "CAT_HUT", nationality: "all", season: "all", valid_from: "2026-10-01", valid_to: "2027-09-30", rate_single: null, rate_double: 16000, weekend_rate_double: 16000, meal_plan: "AP", tax_pct: 0, rates_include_tax: true, active: true },
  ],
  calendar: [
    { calendar: "pugdundee", season: "shoulder", date_from: "2026-10-01", date_to: "2026-10-31", active: true },
    { calendar: "pugdundee", season: "shoulder", date_from: "2026-11-01", date_to: "2026-11-15", active: true },
  ],
  parks: [{ id: "TAD", name: "Tadoba-Andhari Tiger Reserve" }, { id: "PAN", name: "Panna National Park" }],
  safaris: (["morning", "afternoon"] as const).flatMap((session) => [
    { park_id: "TAD", zone: "core", session, vehicle_type: "exclusive_jeep", nationality: "foreign", valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: 11500, weekend_rate: 12500, naturalist_fee: 2500, tax_pct: 5, active: true, book_min_days: 4, book_max_days: 59 },
    { park_id: "TAD", zone: "core", session, vehicle_type: "exclusive_jeep", nationality: "foreign", valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: 14500, weekend_rate: 14500, naturalist_fee: 2500, tax_pct: 5, active: true, book_min_days: 60, book_max_days: 120 },
    { park_id: "TAD", zone: "buffer", session, vehicle_type: "exclusive_jeep", nationality: "indian", valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: 13000, weekend_rate: 14000, naturalist_fee: 0, tax_pct: 5, active: true },
    { park_id: "PAN", zone: "core", session, vehicle_type: "exclusive_jeep", nationality: "all", valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: 15000, weekend_rate: 16000, naturalist_fee: 0, tax_pct: 5, active: true },
  ]),
};
const all = auditRates(full);
const find = (source: string, item: string) => all.find((r) => r.source === source && r.item === item);

test("tariff: foreign seasons and the Indian published rate; amount, dates and missing rows", () => {
  assert.equal(find("Tariff 2026-27", "Cottage, foreign, shoulder")?.status, "ok");
  assert.equal(find("Tariff 2026-27", "Cottage, foreign, high")?.status, "different"); // 21,000 saved, 22,000 on the tariff
  assert.equal(find("Tariff 2026-27", "Cottage, foreign, peak")?.status, "missing");
  assert.equal(find("Tariff 2026-27", "Cottage, Indian (published)")?.status, "dates"); // ends 31 Mar, not 30 Sep 2027
  assert.equal(find("Tariff 2026-27", "Tree House, foreign, shoulder")?.status, "missing"); // "Treehouse" is the same category
  assert.equal(find("Tariff 2026-27", "Forest Suite, foreign, shoulder")?.status, "not found");
});

test("season calendar: a range as on the tariff, a range with other dates, a missing one", () => {
  assert.equal(find("Tariff 2026-27", "Season calendar: 2026-10-01 to 2026-10-31")?.status, "ok");
  const nov = find("Tariff 2026-27", "Season calendar: 2026-11-01 to 2026-11-30");
  assert.equal(nov?.status, "dates");
  assert.match(nov!.found, /shoulder 2026-11-01 to 2026-11-15/);
  assert.equal(find("Tariff 2026-27", "Season calendar: 2027-05-16 to 2027-06-30")?.status, "missing");
});

test("safaris: Tadoba by booking window, Panna taxes included, missing parks", () => {
  assert.equal(find("Safaris and activities - foreigners", "Tadoba core, foreign, booked 4-59 days ahead, morning")?.status, "ok");
  assert.equal(find("Safaris and activities - foreigners", "Tadoba core, foreign, booked 60-120 days ahead, evening")?.status, "different"); // weekend 14,500 vs 19,000
  assert.equal(find("Safaris and activities - foreigners", "Tadoba buffer, foreign, morning")?.status, "missing");
  // Indian guests: no naturalist fee on that document, so it is not checked
  assert.equal(find("Safari rates - Indian guests", "Tadoba buffer, indian, evening")?.status, "ok");
  assert.equal(find("Safari rates - Indian guests", "Tadoba core, indian, booked 4-59 days ahead, morning")?.status, "missing");
  assert.equal(find("Ken River Lodge B2B", "Panna core, morning")?.status, "gst"); // 5% added, the B2B rate includes taxes
  assert.equal(find("Safaris and activities - foreigners", "Kanha core, foreign")?.status, "not found");
  // the MP rates are checked for the whole 2026-27 season (a December date)
  assert.ok(CARD_SAFARIS.filter((c) => c.park === "Kanha").every((c) => c.on === "2026-12-15"));
});

test("Ken River Lodge rooms: B2B weekday / weekend, from the room's rate or its tariff category", () => {
  const stilted = find("Ken River Lodge B2B", "Ken River Lodge: Stilted River Facing Cottage (2 guests)");
  assert.equal(stilted?.status, "ok");
  assert.equal(stilted!.found, "Rs 16,500 / Rs 17,500 / Rs 18,500 incl. GST");
  const hut = find("Ken River Lodge B2B", "Ken River Lodge: AC Premium Hut (2 guests)");
  assert.equal(hut?.status, "different");
  assert.match(hut!.found, /published tariff/);
  assert.equal(find("Ken River Lodge B2B", "Ken River Lodge: AC Villa Cottage, 3 bedrooms (6 guests)")?.status, "not found");
});

test("Tadoba supplements at Waghoba: Moharli gate, modified Gypsy and Scorpio, per safari + 5%", () => {
  const withWaghoba: AuData = {
    ...data,
    properties: [...data.properties, { id: "WEL", name: "Waghoba Eco Lodge", kind: "own_lodge" }],
    addons: [
      ...data.addons,
      { name: "Core safari from Moharli gate", property_id: "WEL", rate: 4000, rate_foreign: null, tax_pct: 5, active: true },
      { name: "Modified luxury Gypsy (per safari)", property_id: "WEL", rate: 5000, rate_foreign: null, tax_pct: 5, active: true },
    ],
  };
  const r = auditRates(withWaghoba);
  const get = (label: string) => r.find((x) => x.item === `Waghoba Eco Lodge: ${label}`);
  assert.equal(get("Core safari from Moharli gate (extra per safari)")?.status, "ok");
  assert.equal(get("Modified Gypsy (extra per safari)")?.status, "different");
  assert.equal(get("Modified Scorpio (extra per safari)")?.status, "missing");
});
