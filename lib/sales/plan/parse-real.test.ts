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

test("the US guests enquiry: nights from days, safaris, naturalists, experiences, flights, Delhi nights", () => {
  const US = "i am having 3 guests travelling from US they will arrive at delhi than stay in delhi for one night than they have flight to jabalpur at 8:30 on 20th of december 2026 than they will travel to bandhavgarh and stay in the kings lodge for 3 days and do 4 safaris with naturalist, than they will travel to pench stay there for 2 days do 2 safaris there one with naturalist one without, than kanha for 2 day 1 safari with naturalist, bush dining, than they will leave to satpura stay there for 2 days 1 tiger safari with naturalist and 1 boat safari also bush dining there than they will leave to bhopal and from there they will pick the flight to delhi stay there one night than they will back to US";
  const p = read(US);
  assert.equal(p.adults, 3);
  assert.equal(p.country, "US");
  assert.equal(p.arrival_date, "2026-12-20");
  assert.equal(p.arrival_place, "Jabalpur Airport");
  assert.equal(p.departure_place, "Bhopal Airport");
  assert.deepEqual(
    p.parks.map((x) => [x.name.split(" ")[0], x.nights, x.safaris, x.naturalists, x.extras ?? []]),
    [["Bandhavgarh", 3, 4, 4, []], ["Pench", 2, 2, 1, []], ["Kanha", 2, 1, 1, ["bush dinner"]], ["Satpura", 2, 1, 1, ["bush dinner", "boat safari"]]]
  );
  assert.equal(p.parks[0].lodge, "Kings Lodge");
  assert.deepEqual(p.flights, [{ from: "Delhi", to: "Jabalpur", time: "8:30" }, { from: "Bhopal", to: "Delhi" }]);
  assert.deepEqual(p.cityStays, [{ when: "before", city: "Delhi", nights: 1 }, { when: "after", city: "Delhi", nights: 1 }]);
});

test("corrections and room words", () => {
  assert.equal(read("sorry, wrong direction").reverse, true);
  assert.equal(read("do it the other way round").reverse, true);
  assert.equal(read("Pench 2 nights in a tree house").parks[0].room, "tree");
  assert.equal(read("Kanha 2 nights, cottage").parks[0].room, "cottage");
  assert.equal(read("Tree House Hideaway 2 nights").parks[0].room, undefined); // the lodge's name is not a room choice
  assert.equal(read("Kanha 2 nights, 3 safaris without naturalist").parks[0].naturalists, 0);
});

test("second US enquiry: Delhi night before, fly Delhi-Bhopal, two Bandhavgarh lodges, leave Nagpur-Delhi", () => {
  const T = "there are 4 adults coming from US one 20th dec 2026 they land on delhi stay one night at delhi than fly to bhopal travel to denwa stay there for 2 days do 2 core safari, 1 boat safari, bush dinner than they will go to pench stay there 2 night do 2 core safari, than kanha 2 nights do 2 core safaris, than they will go to bandhavgarh stay in kings for 1 night 1 core safari, than 1 night in tree house 1 core safari there than they will go to tadoba stay there 2 nights do 2 core safari with naturalist than 1 bush dinner there, all stays they will do nature walk and any special also if any lodge is having they will do that as well, then they will leave from nagpur to delhi stay in delhi one night and leave back to USA";
  const p = read(T);
  assert.deepEqual(p.flights, [{ from: "Delhi", to: "Bhopal" }, { from: "Nagpur", to: "Delhi" }]);
  assert.deepEqual([...(p.cityStays ?? [])].sort((a, b) => a.when.localeCompare(b.when)), [{ when: "after", city: "Delhi", nights: 1 }, { when: "before", city: "Delhi", nights: 1 }]);
  assert.deepEqual(
    p.parks.map((x) => [x.lodge ?? x.name.split(" ")[0], x.nights, x.safaris ?? null]),
    [["Denwa Backwater Escape", 2, 2], ["Pench", 2, 2], ["Kanha", 2, 2], ["Kings Lodge", 1, 1], ["Tree House Hideaway", 1, 1], ["Tadoba-Andhari", 2, 2]]
  );
  assert.equal(p.parks[5].naturalists, 2);
  // "all stays ... nature walk ... any special": every lodge; bush dinner only where it was asked
  assert.ok(p.parks.every((x) => x.extras?.includes("nature walk") && x.extras?.includes("special")));
  assert.deepEqual(p.parks.filter((x) => x.extras?.includes("bush dinner")).map((x) => x.lodge ?? x.name.split(" ")[0]), ["Denwa Backwater Escape", "Tadoba-Andhari"]);
  // "Tadoba stay there 2 nights" is Tadoba, not a city stay
  assert.ok(!(p.cityStays ?? []).some((c) => c.nights === 2));
});

test("Hinglish enquiry without the AI: log, raat, din, bacche, sab safari naturalist ke saath, wapas", () => {
  const p = read("2 log aa rahe hai 16 jan ko nagpur, pehle tadoba 4 raat phir pench 3 raat, sab safari naturalist ke saath, wapas nagpur se");
  assert.equal(p.adults, 2);
  assert.equal(p.arrival_date, "2027-01-16");
  assert.deepEqual(p.parks.map((x) => [x.name.split(" ")[0], x.nights, x.naturalists ?? null]), [["Tadoba-Andhari", 4, -1], ["Pench", 3, -1]]);
  assert.equal(p.arrival_place, "Nagpur Airport");
  assert.equal(p.departure_place, "Nagpur Airport");
  const q = read("4 bande aur 2 bacche, kanha 3 din, jabalpur se");
  assert.equal(q.adults, 4);
  assert.equal(q.children?.length, 2);
  assert.equal(q.parks[0].nights, 3);
  assert.equal(q.parks[0].nightsFromDays, true);
  // "dinner" is not "din"
  assert.equal(read("Kanha 2 nights, bush dinner").parks[0].nights, 2);
});
