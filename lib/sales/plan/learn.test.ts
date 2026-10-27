// Learning from corrections: what the sales person changed becomes a suggested rule,
// and once approved the reader gets it right by itself.
// Run with:  npx tsx --test lib/sales/plan/learn.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "./chat";
import { readerRows, suggestRules } from "./learn";
import { defaultStop, emptyPlan } from "./planner";
import { readerCtx as ctx, READER_TODAY as TODAY } from "./reader-fixture";
import type { BuilderContext, Plan } from "./types";

const readWith = (c: BuilderContext, msg: string) => {
  const p = emptyPlan(TODAY);
  return chatTurn(p, initialFlags(p), msg, c, TODAY).plan;
};
const saved = (msg: string, change: (p: Plan) => Plan) => change(readWith(ctx, msg));
const teach = (rules: { phrase: string; meaning: string }[]): BuilderContext => ({ ...ctx, readerRules: rules });

test("a park the reader missed: the unknown word becomes that lodge", () => {
  const msg = "2 adults, chitrakoot 2n then kanha 3n, jabalpur in out";
  const quote = saved(msg, (p) => ({ ...p, stops: [defaultStop(ctx, "SAT", 2), ...p.stops] }));
  assert.deepEqual(suggestRules(msg, quote, ctx, TODAY), [{ phrase: "chitrakoot", meaning: "Denwa Backwater Escape", kind: "lodge" }]);
  // approved: read right the next time
  const p = readWith(teach([{ phrase: "chitrakoot", meaning: "Denwa Backwater Escape" }]), msg);
  assert.deepEqual(p.stops.map((s) => [s.park_id, s.nights]), [["SAT", 2], ["KAN", 3]]);
});

test("another lodge in the same park", () => {
  const msg = "2 adults, bandhavgarh machan 2n, jabalpur in out";
  const quote = saved(msg, (p) => ({ ...p, stops: p.stops.map((s) => ({ ...s, property_id: "THH", room_category_id: "THH_T" })) }));
  assert.deepEqual(suggestRules(msg, quote, ctx, TODAY), [{ phrase: "machan", meaning: "Tree House Hideaway", kind: "lodge" }]);
  assert.equal(readWith(teach([{ phrase: "machan", meaning: "Tree House Hideaway" }]), msg).stops[0].property_id, "THH");
});

test("a word for nights", () => {
  const msg = "2 adults, kanha 3 ratri, jabalpur in out";
  const quote = saved(msg, (p) => ({ ...p, stops: p.stops.map((s) => ({ ...s, nights: 3 })) }));
  assert.deepEqual(suggestRules(msg, quote, ctx, TODAY), [{ phrase: "ratri", meaning: "nights", kind: "nights" }]);
  assert.equal(readWith(teach([{ phrase: "ratri", meaning: "nights" }]), msg).stops[0].nights, 3);
});

test("their own vehicle, said in a way the reader did not know", () => {
  const msg = "2 adults, kanha 3n, gaddi apni hai";
  const quote = saved(msg, (p) => ({ ...p, own_vehicle: true, arrival_location_id: null, departure_location_id: null }));
  assert.deepEqual(suggestRules(msg, quote, ctx, TODAY), [{ phrase: "gaddi", meaning: "own vehicle", kind: "transport" }]);
  assert.equal(readWith(teach([{ phrase: "gaddi", meaning: "own vehicle" }]), msg).own_vehicle, true);
});

test("nothing changed, or nothing unknown: no rule is suggested", () => {
  const msg = "2 adults, kanha 3n, jabalpur in out";
  assert.deepEqual(suggestRules(msg, readWith(ctx, msg), ctx, TODAY), []);
  // a change with no unknown word to pin it on: nothing (never a guess)
  const quote = saved(msg, (p) => ({ ...p, stops: p.stops.map((s) => ({ ...s, nights: 4 })) }));
  assert.deepEqual(suggestRules(msg, quote, ctx, TODAY), []);
});

test("rows for the database: rules from corrections, and the other unknown words", () => {
  const rows = readerRows([{ phrase: "gaddi", meaning: "own vehicle", kind: "transport" }], ["gaddi", "shikara"], "2 adults, kanha 3n, gaddi apni hai");
  assert.deepEqual(rows, [
    { phrase: "gaddi", meaning: "own vehicle", kind: "transport", source: "correction", example: "2 adults, kanha 3n, gaddi apni hai" },
    { phrase: "shikara", meaning: null, kind: "word", source: "unknown", example: "2 adults, kanha 3n, gaddi apni hai" },
  ]);
});
