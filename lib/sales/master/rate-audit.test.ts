// Run with:  npx tsx --test lib/sales/master/rate-audit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRates, type AuData, type AuRoomRate } from "./rate-audit";
import { CARD_TRANSFERS, RATE_CARD_QUESTIONS } from "./rate-card";

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
  addons: [{ name: "Khajuraho sightseeing (per vehicle)", property_id: "RAD", rate: 6000, rate_foreign: null, tax_pct: 5, active: true }],
};
const rows = auditRates(data);
const row = (source: string, item: string) => rows.find((r) => r.source === source && r.item === item);

test("the selling-rate card has 33 roads", () => {
  assert.equal(CARD_TRANSFERS.length, 33);
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
  // a road "via" a place is a question, never loaded
  assert.equal(rows.find((r) => r.item === "Kanha - Jabalpur via Bedaghat")?.status, "not found");
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
  assert.ok(RATE_CARD_QUESTIONS.some((q) => /via/.test(q)));
  assert.ok(RATE_CARD_QUESTIONS.some((q) => /Foreign-nationals tariff/.test(q)));
});
