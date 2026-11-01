// The one reading flow, AI first: memory, then the AI (every value quoted from the message),
// the built-in reader filling only what the AI left empty, or reading alone without the AI.
// Run with:  npx tsx --test lib/sales/plan/reading.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiToParsed } from "./ai";
import { chatTurn, initialFlags } from "./chat";
import { checkEvidence } from "./evidence";
import { emptyPlan } from "./planner";
import { DELHI_KAZIRANGA, jorhatCtx as ctx, READER_TODAY as TODAY } from "./reader-fixture";
import { dateOf, isShortAnswer, mergeAiFirst, normaliseEnquiry, patternFromPlan, pickPattern, structureOf } from "./reading";
import type { BuilderContext, Plan } from "./types";

const route = (p: Plan) => p.stops.map((s) => `${s.park_id} ${s.nights} ${s.property_id}`);
const first = (msg: string, extra?: Parameters<typeof chatTurn>[5], c: BuilderContext = ctx) => {
  const p = emptyPlan(TODAY);
  return chatTurn(p, initialFlags(p), msg, c, TODAY, extra);
};
// what the server does with Gemini's answer: the evidence rule, then the browser's master-data check
const ai = (answer: unknown, msg: string, c: BuilderContext = ctx) => ({ parsed: aiToParsed(checkEvidence(answer, msg, c).reading, c), source: "ai" as const });

// What Gemini answered for the enquiry of 30 Oct 2026 (the misread): Kings Lodge, Kanha 2, Pench 1,
// with quotes the message does not have.
const MISREAD = {
  replace_route: { value: true, quote: "starting 1st april" },
  stops: [
    { park: { value: "Bandhavgarh National Park", quote: "Tree House Bandhavgarh" }, lodge: { value: "Kings Lodge", quote: "kings lodge bandhavgarh" }, nights: { value: 3, quote: "3 nights Tree House" } },
    { park: { value: "Kanha National Park", quote: "3 nights Kanha" }, nights: { value: 2, quote: "kanha 2 nights" } },
    { park: { value: "Pench National Park", quote: "2 nights Pench" }, nights: { value: 1, quote: "2 nights Pench" } },
    { park: { value: "Kaziranga National Park", quote: "3 nights Kaziranga" }, lodge: { value: "Iora Retreat", quote: "Iora" }, nights: { value: 3, quote: "3 nights Kaziranga" } },
  ],
};

test("normalising: names, emails and phones out, number words as digits, taught phrases applied", () => {
  const n = normaliseEnquiry("Mr Shah, two adults, THH three nights!  email a@b.com +91 98765 43210", [{ phrase: "THH", meaning: "Tree House Hideaway" }]);
  assert.equal(n, "[guest], 2 adults, tree house hideaway 3 nights email [email] [number]");
  assert.equal(normaliseEnquiry("Kanha 3 nights, Pench 2 nights."), normaliseEnquiry("kanha  3 nights ,pench two nights"));
});

test("the shape of an enquiry: dates and numbers taken out in order", () => {
  const { structure, tokens } = structureOf(normaliseEnquiry("starting 1st april - 1 night delhi, kanha 3 nights, 16/01 back"), TODAY);
  assert.equal(structure, "starting #d - # night delhi, kanha # nights, #d back");
  assert.deepEqual(tokens, [{ kind: "d", raw: "1st april", iso: "2027-04-01" }, { kind: "n", value: 1 }, { kind: "n", value: 3 }, { kind: "d", raw: "16/01", iso: "2027-01-16" }]);
  assert.equal(dateOf("16 jan 27", TODAY), "2027-01-16");
  assert.equal(dateOf("31/02", TODAY), null);
});

test("the misread AI answer: what the message does not say is thrown away, the trip stays right", () => {
  const { reading, dropped } = checkEvidence(MISREAD, DELHI_KAZIRANGA, ctx);
  // Kings Lodge and Iora (not in the message), Kanha 2 ("Kanha, 2 nights" is two parts of the
  // trip, across a comma) and Pench 1 (the quote says 2) are dropped
  assert.deepEqual(
    dropped.map((d) => `${d.field}: ${d.reason}`),
    ["stops[0].lodge: quote not in the message", "stops[1].nights: quote not in the message", "stops[2].nights: quote does not say it", "stops[3].lodge: quote not in the message"]
  );
  assert.equal((reading.stops as { lodge?: string }[])[0].lodge, undefined);
  const r = first(DELHI_KAZIRANGA, ai(MISREAD, DELHI_KAZIRANGA));
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "KAN 3 KEL", "PEN 2 PTL", "KAZ 3 IORA"]);
  assert.equal(r.plan.arrival_location_id, "JLR");
  // and no "I read X, the AI read Y" question
  assert.ok(!r.reply.checklist?.some((c) => c.key.startsWith("ask:conflict:")));
});

test("AI first: a value the AI quoted wins; the reader fills only what the AI left empty", () => {
  const rule = { parks: [{ name: "Tadoba-Andhari Tiger Reserve", nights: 1, lodge: "Waghoba Eco Lodge" }], notes: [], adults: 2 };
  const aiP = { parks: [{ name: "Tadoba-Andhari Tiger Reserve", nights: 3 }], notes: [] };
  const { parsed, fromReader } = mergeAiFirst(aiP, rule);
  assert.equal(parsed.parks[0].nights, 3); // the AI's quoted 3, not the reader's 1
  assert.equal(parsed.parks[0].lodge, "Waghoba Eco Lodge"); // the AI gave no lodge: the reader's
  assert.equal(parsed.adults, 2);
  assert.deepEqual(fromReader.sort(), ["guests", "lodge"]);
  assert.deepEqual(parsed.asks, []); // never a question about the two readings
  // a fuller list of city nights from the reader (the AI quoted fewer) is taken
  const g = mergeAiFirst(
    { parks: [], notes: [], cityStays: [{ when: "before", city: "Delhi", nights: 1, hotel: "Roseate House" }] },
    { parks: [], notes: [], cityStays: [{ when: "before", city: "Delhi", nights: 1 }, { when: "after", city: "Delhi", nights: 1, at: 1 }] }
  );
  assert.deepEqual(g.parsed.cityStays?.map((c) => [c.city, c.at ?? null, c.hotel ?? null]), [["Delhi", null, "Roseate House"], ["Delhi", 1, null]]);
  // a stop the AI did not quote, in the same order: the reader's list, the AI's details kept
  const s = mergeAiFirst({ parks: [{ name: "Pench National Park", nights: 2 }], notes: [] }, { parks: [{ name: "Kanha National Park", nights: 3 }, { name: "Pench National Park" }], notes: [] });
  assert.deepEqual(s.parsed.parks.map((p) => [p.name, p.nights]), [["Kanha National Park", 3], ["Pench National Park", 2]]);
});

test("the reader fills what the AI left empty, and says so under the reply", () => {
  const msg = "kanha 3 nights, 2 adults indian, 16 jan 27, jabalpur in out";
  const answer = { stops: [{ park: { value: "Kanha National Park", quote: "kanha 3 nights" }, nights: { value: 3, quote: "3 nights" } }], adults: { value: 4, quote: "4 adults" } };
  const r = first(msg, ai(answer, msg));
  assert.equal(r.plan.stops[0].nights, 3);
  assert.equal(r.plan.guest.adults, 2); // "4 adults" is not in the message: the reader's 2
  assert.match(r.reply.source ?? "", /^read by the AI; the built-in reader added: .*guests/);
});

test("a name the AI gives that is not in master data is dropped and asked about", () => {
  const a = aiToParsed({ stops: [{ park: "Ranthambore", nights: 2 }, { park: "Kanha National Park", lodge: "Kanha Jungle Palace", nights: 3 }] }, ctx);
  assert.deepEqual(a.parks.map((p) => [p.name, p.lodge]), [["Kanha National Park", undefined]]);
  assert.deepEqual(a.asks?.map((x) => x.key), ["unknown:ranthambore", "unknown:kanha jungle palace"]);
  assert.match(mergeAiFirst(a, { parks: [], notes: [] }).parsed.asks![0].text, /"Ranthambore" is not in Master data/);
});

test("a short reply to the assistant's own question skips the AI", () => {
  for (const t of ["cottage", "same", "7 and 12", "3", "tree house please"]) assert.equal(isShortAnswer(t, "room"), true, t);
  assert.equal(isShortAnswer("kanha 3 nights then pench 2 nights, 2 adults from UK", "room"), false);
  assert.equal(isShortAnswer("cottage", null), false); // nothing was asked: a new message
  assert.equal(isShortAnswer("kanha 3n", "parks"), false); // "which parks?": the route, read in full
});

test("a saved pattern is read from memory: no AI call, and the quoted trip comes back", () => {
  // the quote as saved: the sales person changed Kanha to 4 nights and added the guests
  const read = first(DELHI_KAZIRANGA).plan;
  const saved: Plan = {
    ...read,
    guest: { ...read.guest, adults: 2, country: "IN", nationality: "indian", name: "Asha Rao" },
    stops: read.stops.map((s) => (s.park_id === "KAN" ? { ...s, nights: 4 } : s)),
  };
  const pattern = patternFromPlan(DELHI_KAZIRANGA, saved, ctx, TODAY);
  assert.ok(pattern);
  const key = normaliseEnquiry(DELHI_KAZIRANGA);
  const hit = pickPattern([pattern], key, structureOf(key, TODAY).tokens, TODAY);
  assert.ok(hit?.exact);
  const r = first(DELHI_KAZIRANGA, { parsed: aiToParsed(hit.reading, ctx), source: "memory" });
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "KAN 4 KEL", "PEN 2 PTL", "KAZ 3 IORA"]);
  assert.equal(r.plan.guest.adults, 2);
  assert.equal(r.plan.guest.country, "IN");
  assert.deepEqual(r.plan.city_stays?.map((c) => [c.when, c.city, c.nights, c.at ?? null]), [["before", "Delhi", 1, null], ["after", "Delhi", 1, 3]]);
  assert.equal(r.reply.source, "from memory");
});

test("the same enquiry with other dates and numbers is read from memory too; an unclear one is not", () => {
  const read = first(DELHI_KAZIRANGA).plan;
  const pattern = patternFromPlan(DELHI_KAZIRANGA, read, ctx, TODAY)!;
  const next = DELHI_KAZIRANGA.replace("starting 1st april", "starting 5th may").replace("2 nights Pench", "4 nights Pench");
  const key = normaliseEnquiry(next);
  assert.equal(structureOf(key, TODAY).structure, pattern.structure);
  const hit = pickPattern([pattern], key, structureOf(key, TODAY).tokens, TODAY);
  assert.ok(hit && !hit.exact);
  const r = first(next, { parsed: aiToParsed(hit.reading, ctx), source: "memory" });
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "KAN 3 KEL", "PEN 4 PTL", "KAZ 3 IORA"]);
  assert.equal(r.plan.days[0].date, "2027-05-05");
  const unclear = normaliseEnquiry(DELHI_KAZIRANGA.replace("3 nights Kanha", "4 nights Kanha"));
  assert.equal(pickPattern([pattern], unclear, structureOf(unclear, TODAY).tokens, TODAY), null);
});

test("the built-in reader alone says so", () => {
  assert.equal(first(DELHI_KAZIRANGA).reply.source, "built-in reader");
});

// Stand-in for the Thompson enquiry (31 Oct 2026): a Delhi night first, then a flight
// Delhi -> Jabalpur; at the end a flight back to Delhi and a Delhi night.
const THOMPSON =
  "Thompson family, 2 adults from UK, 10 feb 1 night delhi, next day fly to jabalpur, kanha 3 nights, bandhavgarh kings lodge 2 nights, back to jabalpur for the flight to delhi, 1 night delhi";
const igi: BuilderContext = { ...ctx, locations: ctx.locations.map((l) => (l.id === "DEL" ? { ...l, name: "Delhi Airport (IGI)" } : l)) };

test("Thompson: an AI that quotes Delhi as the arrival still gives the Jabalpur pick-up (the flights decide), no question", () => {
  const answer = {
    arrival_place: { value: "Delhi Airport (IGI)", quote: "1 night delhi" },
    departure_place: { value: "Delhi Airport (IGI)", quote: "flight to delhi" },
    stops: [
      { park: { value: "Kanha National Park", quote: "kanha 3 nights" }, nights: { value: 3, quote: "kanha 3 nights" } },
      { park: { value: "Bandhavgarh National Park", quote: "bandhavgarh kings lodge" }, lodge: { value: "Kings Lodge", quote: "kings lodge" }, nights: { value: 2, quote: "kings lodge 2 nights" } },
    ],
  };
  const r = first(THOMPSON, ai(answer, THOMPSON, igi), igi);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JLR"]);
  assert.deepEqual(route(r.plan), ["KAN 3 KEL", "BAN 2 KL"]);
  assert.doesNotMatch(r.reply.text, /Where do they arrive|Where does our car pick them up/);
});

test("Thompson: an arrival the message does not say (Nagpur) is dropped, never asked as a conflict", () => {
  const answer = { arrival_place: { value: "Nagpur Airport", quote: "arriving nagpur" } };
  const { dropped } = checkEvidence(answer, THOMPSON, igi);
  assert.deepEqual(dropped.map((d) => d.field), ["arrival_place"]);
  const r = first(THOMPSON, ai(answer, THOMPSON, igi), igi);
  assert.equal(r.plan.arrival_location_id, "JLR");
  assert.doesNotMatch(r.reply.text, /Nagpur/);
});
