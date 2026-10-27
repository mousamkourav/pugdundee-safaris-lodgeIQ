// The words and forms the team uses (CC_ENGINE_TRAINING.md, "Also understand"), read by
// the built-in reader. Run with:  npx tsx --test lib/sales/plan/reader-words.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRules, extractTrip, unknownWords } from "./parse-text";
import { readerCtx as ctx, READER_TODAY } from "./reader-fixture";

const read = (t: string) => extractTrip(t, ctx, READER_TODAY);
const nights = (t: string) => read(t).parks.map((p) => p.nights ?? null);

test("number words in English and Hindi", () => {
  assert.equal(read("do log, kanha 3n").adults, 2);
  assert.equal(read("teen adults, kanha 3n").adults, 3);
  assert.equal(read("char log aa rahe hai, kanha 2n").adults, 4);
  assert.deepEqual(nights("kanha paanch raat"), [5]);
  assert.deepEqual(nights("pench chhe raat"), [6]);
  assert.deepEqual(nights("tadoba saat raat"), [7]);
  assert.deepEqual(nights("kanha ek raat"), [1]);
  // "to do safaris" is not two safaris
  assert.equal(read("kanha 3n, want to do safaris with naturalist").parks[0].safaris, undefined);
});

test("nights: x3, 3N, 3n, 3 raat, 3 din", () => {
  assert.deepEqual(nights("kanha x3"), [3]);
  assert.deepEqual(nights("Kanha 3N"), [3]);
  assert.deepEqual(nights("kanha 3n pench 2n"), [3, 2]);
  assert.deepEqual(nights("kanha 3 raat"), [3]);
  assert.deepEqual(nights("kanha 3 din"), [3]);
});

test("dates: 16 jan, 16/1, 16-01-27, 16th Jan'27, 16 jan 27, next month 5th", () => {
  assert.equal(read("kanha 2n, 16 jan").arrival_date, "2027-01-16");
  assert.equal(read("kanha 2n, 16/1").arrival_date, "2027-01-16");
  assert.equal(read("kanha 2n, 16-01-27").arrival_date, "2027-01-16");
  assert.equal(read("kanha 2n, 16th Jan'27").arrival_date, "2027-01-16");
  assert.equal(read("kanha 2n, 16 jan 27").arrival_date, "2027-01-16");
  assert.equal(read("kanha 2n, 16 jan 27").departure_date, undefined);
  assert.equal(read("kanha 2n, next month 5th").arrival_date, "2026-11-05");
  // a count after the month is not a year or a day
  assert.equal(read("16 jan 2 adults kanha 2n").arrival_date, "2027-01-16");
  assert.equal(read("16 jan 2 adults kanha 2n").adults, 2);
  // a list of ages is not a date
  assert.equal(read("2 adults, kids 6/9, kanha 2n").arrival_date, undefined);
});

test("lodge short forms from the glossary", () => {
  const lodge = (t: string) => read(t).parks.map((p) => p.lodge ?? p.name.split(" ")[0]);
  assert.deepEqual(lodge("THH 2n, KL 1n"), ["Tree House Hideaway", "Kings Lodge"]);
  assert.deepEqual(lodge("KEL 2n, PTL 2n"), ["Kanha Earth Lodge", "Pench Tree Lodge"]);
  assert.deepEqual(lodge("WEL 2n, DBE 2n, KRL 2n"), ["Waghoba Eco Lodge", "Denwa Backwater Escape", "Ken River Lodge"]);
  assert.deepEqual(lodge("BAG 2n"), ["Bandhavgarh"]);
  assert.deepEqual(lodge("BDG 2n"), ["Bandhavgarh"]);
  const p = read("kanha 2n, JBP in, NGP out");
  assert.deepEqual([p.arrival_place, p.departure_place], ["Jabalpur Airport", "Nagpur Airport"]);
});

test("in-out, same airport, wapas", () => {
  let p = read("kanha 2n, jabalpur in-out");
  assert.deepEqual([p.arrival_place, p.departure_place], ["Jabalpur Airport", "Jabalpur Airport"]);
  p = read("arriving jabalpur, kanha 2n, pench 2n, same airport");
  assert.equal(p.departure_place, "Jabalpur Airport");
  assert.equal(p.same_out, true);
  p = read("raipur se aayenge, kanha 2n, wapas nagpur se");
  assert.deepEqual([p.arrival_place, p.departure_place], ["Raipur Airport", "Nagpur Airport"]);
});

test("their own vehicle, self drive, by road, train se, flight se", () => {
  assert.equal(read("self drive, kanha 2n").own_all, true);
  assert.equal(read("khud ki car se aayenge, kanha 2n").own_all, true);
  assert.equal(read("kanha 2n, pench 2n, own vehicle").own_all, true);
  assert.equal(read("kanha 2n, then pench 2n by road").between, "ours");
  assert.equal(read("kanha 2n, then pench 2n in their own car").between, "own");
  let p = read("train se aayenge katni, bandhavgarh 2n");
  assert.deepEqual([p.arrival_mode, p.arrival_place], ["train", "Katni Railway Station"]);
  p = read("kanha 2n, flight se jayenge raipur se");
  assert.deepEqual([p.departure_mode, p.departure_place], ["flight", "Raipur Airport"]);
});

test("taught phrases are read as their meaning (approved rules and the glossary)", () => {
  const taught = { ...ctx, readerRules: [{ phrase: "tadoba core", meaning: "Waghoba Eco Lodge" }, { phrase: "BTH", meaning: "Tree House Hideaway (Bandhavgarh)" }] };
  const p = extractTrip("tadoba core 2n, BTH 1n", taught, READER_TODAY);
  assert.deepEqual(p.parks.map((x) => x.lodge), ["Waghoba Eco Lodge", "Tree House Hideaway"]);
  assert.ok(p.notes.some((n) => /taught/.test(n)));
  // whole words only, longest first, case does not matter
  assert.equal(applyRules("bth and bthx", [{ phrase: "BTH", meaning: "X" }]), "X and bthx");
  assert.equal(applyRules("tadoba core zone", [{ phrase: "tadoba", meaning: "A" }, { phrase: "tadoba core", meaning: "B" }]), "B zone");
});

test("words the reader could not place are listed, names are not", () => {
  assert.deepEqual(unknownWords("2 adults, kanha 3n, jhumri talaiya pickup", ctx), ["jhumri talaiya"]);
  assert.deepEqual(unknownWords("Mrs Kapoor and Rohan, kanha 3n", ctx), []);
  assert.deepEqual(unknownWords("THH 2n, wapas nagpur se, sab safari naturalist ke saath", ctx), []);
  assert.deepEqual(read("kanha 3n with a shikara ride").unknown, ["shikara"]);
});
