// Sales-team phrasing, checked against the REAL master data names
// (the 6 lodges, 5 parks and airports imported from the BAR sheets).
// Run with:  npx tsx --test lib/sales/plan/parse-real.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTrip } from "./parse-text";
import { data } from "@/lib/sales/pricing/sheet-fixture";
import type { BuilderContext } from "./types";

export const realCtx: BuilderContext = {
  pricing: {
    ...data,
    parks: [
      { id: "BAN", name: "Bandhavgarh National Park" },
      { id: "KAN", name: "Kanha National Park" },
      { id: "PEN", name: "Pench National Park" },
      { id: "SAT", name: "Satpura Tiger Reserve" },
      { id: "TAD", name: "Tadoba-Andhari Tiger Reserve" },
    ],
  },
  properties: [
    { id: "KL", name: "Kings Lodge", park_id: "BAN", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "THH", name: "Tree House Hideaway", park_id: "BAN", kind: "own_lodge", fallback_priority: 2, sort: 0 },
    { id: "KEL", name: "Kanha Earth Lodge", park_id: "KAN", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PEN", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "DBE", name: "Denwa Backwater Escape", park_id: "SAT", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TAD", kind: "own_lodge", fallback_priority: 1, sort: 0 },
  ],
  locations: [
    { id: "NAG", name: "Nagpur Airport", type: "airport", property_id: null, code: "NAG" },
    { id: "JLR", name: "Jabalpur Airport", type: "airport", property_id: null, code: "JLR" },
    { id: "RPR", name: "Raipur Airport", type: "airport", property_id: null, code: "RPR" },
    { id: "BHO", name: "Bhopal Airport", type: "airport", property_id: null, code: "BHO" },
    { id: "HJR", name: "Khajuraho Airport", type: "airport", property_id: null, code: "HJR" },
  ],
  rooms: [],
  templates: [],
  content: [],
  cancellation: [],
};
const read = (t: string) => extractTrip(t, realCtx, "2026-10-15");
const route = (t: string) => read(t).parks.map((p) => [p.name.split(" ")[0], p.nights ?? null, p.lodge ?? null]);

test("lodge names instead of park names", () => {
  assert.deepEqual(route("Kanha Earth Lodge 3N, Kings Lodge 2N"), [["Kanha", 3, "Kanha Earth Lodge"], ["Bandhavgarh", 2, "Kings Lodge"]]);
  assert.deepEqual(route("Pench Tree Lodge 3 nights then Waghoba 2 nights"), [["Pench", 3, "Pench Tree Lodge"], ["Tadoba-Andhari", 2, "Waghoba Eco Lodge"]]);
  assert.deepEqual(route("Denwa 2N, Treehouse Hideaway 3N"), [["Satpura", 2, "Denwa Backwater Escape"], ["Bandhavgarh", 3, "Tree House Hideaway"]]);
  assert.deepEqual(route("3 nights at Kings Lodge and 2 nights at Kanha Earth Lodge"), [["Bandhavgarh", 3, "Kings Lodge"], ["Kanha", 2, "Kanha Earth Lodge"]]);
});

test("airport codes and sales shorthand for pick-up and drop", () => {
  let p = read("2 pax ex Jabalpur, Kanha 3N, dep NAG");
  assert.equal(p.arrival_place, "Jabalpur Airport");
  assert.equal(p.departure_place, "Nagpur Airport");
  p = read("arr JLR, Bandhavgarh 3N");
  assert.equal(p.arrival_place, "Jabalpur Airport");
  p = read("pick up from Nagpur, drop at Raipur, Kanha 2N");
  assert.equal(p.arrival_place, "Nagpur Airport");
  assert.equal(p.departure_place, "Raipur Airport");
  p = read("jbp in out, Kanha 2 nights");
  assert.equal(p.arrival_place, "Jabalpur Airport");
  assert.equal(p.departure_place, "Jabalpur Airport");
  p = read("NGP in and out, Pench 3 nights");
  assert.equal(p.arrival_place, "Nagpur Airport");
});

test("dates with an apostrophe year", () => {
  assert.equal(read("Kanha 2N from 10th Feb'27").arrival_date, "2027-02-10");
  assert.equal(read("Kanha 2N, 16 Jan '27").arrival_date, "2027-01-16");
  assert.equal(read("Kanha 2N, Jan 16 '27").arrival_date, "2027-01-16");
});

test("children written the way people write them", () => {
  assert.deepEqual(read("2 adults + 2 kids (6, 9), Kanha 2N").children, [6, 9]);
  assert.deepEqual(read("2 adults, kids 6 & 9, Kanha 2N").children, [6, 9]);
  assert.deepEqual(read("2 adults with a 6 year old, Kanha 2N").children, [6]);
  assert.deepEqual(read("2 adults and 1 child of 8 yrs, Kanha 2N").children, [8]);
});

test("rooms with a word in between", () => {
  assert.equal(read("1 double room, Kanha 2N").rooms, 1);
  assert.equal(read("2 twin rooms, Kanha 2N").rooms, 2);
  assert.equal(read("3 AC cottages, Kanha 2N").rooms, 3);
});

test("spelling mistakes in park and lodge names", () => {
  assert.deepEqual(route("couple, bandavgarh 3 nights")[0].slice(0, 2), ["Bandhavgarh", 3]);
  assert.deepEqual(route("bandhavgad 2n, kanah 2n").map((r) => r[0]), ["Bandhavgarh", "Kanha"]);
  assert.deepEqual(route("waghobha 3 nights")[0], ["Tadoba-Andhari", 3, "Waghoba Eco Lodge"]);
});

test("a full enquiry in sales shorthand", () => {
  const p = read("Mr Shah, 2A + 1 child (8), Kanha Earth Lodge 3N, Kings Lodge 2N, ex JBP 10th Feb'27, dep JBP, 1 double room, full board");
  assert.equal(p.adults, 2);
  assert.deepEqual(p.children, [8]);
  assert.equal(p.rooms, 1);
  assert.equal(p.arrival_date, "2027-02-10");
  assert.equal(p.arrival_place, "Jabalpur Airport");
  assert.equal(p.departure_place, "Jabalpur Airport");
  assert.equal(p.meal_plan, "AP");
  assert.deepEqual(p.parks.map((x) => [x.lodge, x.nights]), [["Kanha Earth Lodge", 3], ["Kings Lodge", 2]]);
});

test("ordinary words are never corrected into park or lodge names", () => {
  const p = read("Hello, we are a family looking for tigers and lodges with pools. Our kids love punch, peach, karma, dense forests, houses, kingdom, kind regards, sandals, panthers, denim, dance, wagons, pension, pencils");
  assert.deepEqual(p.parks, []);
  assert.deepEqual(p.notes.filter((n) => n.startsWith("Read")), []);
  for (const [typo, park] of [["satpra 2n", "Satpura"], ["pnech 2n", "Pench"], ["tadobaa 2n", "Tadoba-Andhari"]]) {
    assert.equal(read(typo).parks[0]?.name.split(" ")[0], park, typo);
  }
});
