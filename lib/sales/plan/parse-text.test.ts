// Run with:  npx tsx --test lib/sales/plan/parse-text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTrip, applyParsed, scrubForAI } from "./parse-text";
import { emptyPlan } from "./planner";
import { data } from "@/lib/sales/pricing/sheet-fixture";
import type { BuilderContext } from "./types";

const ctx: BuilderContext = {
  pricing: {
    ...data,
    parks: [
      { id: "TADOBA", name: "Tadoba-Andhari Tiger Reserve" },
      { id: "PENCH", name: "Pench National Park" },
      { id: "KANHA", name: "Kanha National Park" },
      { id: "BANDHAV", name: "Bandhavgarh National Park" },
      { id: "SATPURA", name: "Satpura Tiger Reserve" },
    ],
  },
  properties: [
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TADOBA", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PENCH", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "KEL", name: "Kanha Earth Lodge", park_id: "KANHA", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "KL", name: "Kings Lodge", park_id: "BANDHAV", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "THH", name: "Tree House Hideaway", park_id: "BANDHAV", kind: "own_lodge", fallback_priority: 2, sort: 0 },
  ],
  locations: [
    { id: "NAGST", name: "Nagpur Railway Station", type: "railway", property_id: null },
    { id: "NAG", name: "Nagpur Airport", type: "airport", property_id: null },
    { id: "JLR", name: "Jabalpur Airport", type: "airport", property_id: null },
    { id: "KTE", name: "Katni Junction", type: "railway", property_id: null },
  ],
  rooms: [
    { id: "WEL_AC", property_id: "WEL", name: "AC Cottage", sort: 0 },
    { id: "PTL_AC", property_id: "PTL", name: "AC Cottage", sort: 0 },
  ],
  templates: [],
};
const TODAY = "2026-10-05";
const read = (t: string) => extractTrip(t, ctx, TODAY);

test("the sheet trip, written the way sales writes it", () => {
  const p = read("2 adults, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, departing Nagpur, full board, 2 rooms");
  assert.equal(p.adults, 2);
  assert.equal(p.rooms, 2);
  assert.equal(p.arrival_date, "2027-01-16");
  assert.equal(p.meal_plan, "AP");
  assert.deepEqual(p.parks.map((x) => [x.name, x.nights]), [["Tadoba-Andhari Tiger Reserve", 4], ["Pench National Park", 3]]);
  assert.equal(p.arrival_place, "Nagpur Airport"); // airport preferred over the station
  assert.equal(p.departure_place, "Nagpur Airport");
});

test("short form: 4N Kanha + 3N Bandhavgarh, Jabalpur in/out, couple, date range", () => {
  const p = read("Couple from UK, 10-17 Feb 2027, 4N Kanha + 3N Bandhavgarh, Jabalpur in/out");
  assert.equal(p.adults, 2);
  assert.equal(p.arrival_date, "2027-02-10");
  assert.equal(p.departure_date, "2027-02-17");
  assert.deepEqual(p.parks.map((x) => [x.name, x.nights]), [["Kanha National Park", 4], ["Bandhavgarh National Park", 3]]);
  assert.equal(p.arrival_place, "Jabalpur Airport");
  assert.equal(p.departure_place, "Jabalpur Airport");
});

test("family with children ages, Indian, no year in the date, one park with nights from the dates", () => {
  const p = read("Family of 4 with 2 kids aged 8 and 12, Indian nationals, Pench from 20 Dec to 23 Dec, Nagpur in and out");
  assert.deepEqual(p.children, [8, 12]);
  assert.equal(p.adults, 2);
  assert.equal(p.nationality, "indian");
  assert.equal(p.arrival_date, "2026-12-20");
  assert.equal(p.parks[0].nights, 3);
});

test("a date earlier in the year without a year means next year", () => {
  assert.equal(read("Tadoba 2 nights, March 5").arrival_date, "2027-03-05");
  assert.equal(read("Tadoba 2 nights on 15/11/2026").arrival_date, "2026-11-15");
});

test("nights written before the park, lodge named, words for numbers", () => {
  const p = read("three adults, 3 nights at Kings Lodge in Bandhavgarh, then 2 nights in Tadoba, arrive Katni junction on 1st March 2027, fly out of Nagpur");
  assert.equal(p.adults, 3);
  assert.deepEqual(p.parks.map((x) => [x.name, x.nights, x.lodge]), [["Bandhavgarh National Park", 3, "Kings Lodge"], ["Tadoba-Andhari Tiger Reserve", 2, undefined]]);
  assert.equal(p.arrival_place, "Katni Junction");
  assert.equal(p.departure_place, "Nagpur Airport");
  assert.equal(p.arrival_date, "2027-03-01");
});

test("apply: fills the plan and lists what was understood and what is missing", () => {
  const plan = emptyPlan(TODAY);
  const r = applyParsed(plan, read("2 adults, Tadoba 4 nights, Pench 3 nights, Nagpur in/out, 16 Jan 2027"), ctx);
  assert.equal(r.plan.stops.length, 2);
  assert.equal(r.plan.stops[0].property_id, "WEL");
  assert.equal(r.plan.arrival_location_id, "NAG");
  assert.equal(r.plan.guest.rooms, 1); // 2 adults -> 1 room assumed
  assert.ok(r.understood.some((u) => u.includes("Tadoba-Andhari Tiger Reserve 4 nights at Waghoba Eco Lodge")));
  const r2 = applyParsed(plan, read("some guests want tigers"), ctx);
  assert.ok(r2.missing.includes("arrival date") && r2.missing.includes("parks"));
});

test("names and contact details are removed before anything goes to an AI", () => {
  const s = scrubForAI("Judy Miller judy@example.com +1 415 555 0142 wants Tadoba");
  assert.ok(!s.includes("@") && !s.includes("415"));
});

test("more ways of writing the same route", () => {
  const cases: [string, [string, number | undefined][]][] = [
    ["Tadoba 4 nights, Pench 3 nights", [["Tadoba-Andhari Tiger Reserve", 4], ["Pench National Park", 3]]],
    ["Tadoba - 4N, Pench - 3N", [["Tadoba-Andhari Tiger Reserve", 4], ["Pench National Park", 3]]],
    ["Kanha x3, Pench x2", [["Kanha National Park", 3], ["Pench National Park", 2]]],
    ["2 nights Kanha, 2 nights Satpura", [["Kanha National Park", 2], ["Satpura Tiger Reserve", 2]]],
    ["Bandhavgarh (3 nights) and Kanha (4 nights)", [["Bandhavgarh National Park", 3], ["Kanha National Park", 4]]],
    ["Bandhavgarh for 3 nights followed by Kanha for 2 nights", [["Bandhavgarh National Park", 3], ["Kanha National Park", 2]]],
    ["tadoba andhari 3n pench 2n", [["Tadoba-Andhari Tiger Reserve", 3], ["Pench National Park", 2]]],
    ["Kanha and Pench", [["Kanha National Park", undefined], ["Pench National Park", undefined]]],
  ];
  for (const [text, want] of cases) {
    assert.deepEqual(read(text).parks.map((x) => [x.name, x.nights]), want, text);
  }
});

test("dates in many formats", () => {
  const cases: [string, string][] = [
    ["arrive 2027-01-16", "2027-01-16"],
    ["arrive 16/01/2027", "2027-01-16"],
    ["arrive 16.1.27", "2027-01-16"],
    ["arrive 16th January 2027", "2027-01-16"],
    ["arrive Jan 16, 2027", "2027-01-16"],
    ["arrive 16 jan", "2027-01-16"],
    ["arrive 3rd of Nov", "2026-11-03"],
    ["arrive Sept 9", "2027-09-09"],
  ];
  for (const [text, want] of cases) assert.equal(read(text).arrival_date, want, text);
  assert.equal(read("arrive 31 Feb 2027").arrival_date, undefined);
});
