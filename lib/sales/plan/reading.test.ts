// The one reading flow: memory first, then the built-in reader, the AI only for gaps.
// Run with:  npx tsx --test lib/sales/plan/reading.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiToParsed } from "./ai";
import { chatTurn, initialFlags } from "./chat";
import { emptyPlan } from "./planner";
import { extractTrip, unknownWords } from "./parse-text";
import { cityHotels, safariOnly } from "./cities";
import { DELHI_KAZIRANGA, jorhatCtx as ctx, READER_TODAY as TODAY } from "./reader-fixture";
import { chooseSource, dateOf, fillGaps, gapsOf, normaliseEnquiry, patternFromPlan, pickPattern, structureOf } from "./reading";
import type { Plan } from "./types";

const route = (p: Plan) => p.stops.map((s) => `${s.park_id} ${s.nights} ${s.property_id}`);
const first = (msg: string, extra?: Parameters<typeof chatTurn>[5]) => {
  const p = emptyPlan(TODAY);
  return chatTurn(p, initialFlags(p), msg, ctx, TODAY, extra);
};

// What Gemini answered for the enquiry of 30 Oct 2026 (the misread): Kings Lodge, Kanha 2, Pench 1.
const MISREAD = {
  replace_route: true,
  arrival_date: "2027-04-02",
  arrival_place: "Jabalpur Airport",
  departure_place: "Jorhat Airport",
  stops: [
    { park: "Bandhavgarh National Park", lodge: "Kings Lodge", nights: 3 },
    { park: "Kanha National Park", nights: 2 },
    { park: "Pench National Park", nights: 1 },
    { park: "Kaziranga National Park", lodge: "Iora Retreat", nights: 3 },
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

test("the AI cannot override the reader: the misread answer leaves Tree House 3, Kanha 3, Pench 2", () => {
  const r = first(DELHI_KAZIRANGA, { parsed: aiToParsed(MISREAD, ctx), source: "ai" });
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "KAN 3 KEL", "PEN 2 PTL", "KAZ 3 IORA"]);
  assert.equal(r.plan.arrival_location_id, "JLR");
  // where they disagree, one clear question at a time, with both answers as one-click replies
  assert.match(r.reply.text, /Bandhavgarh: I read Tree House Hideaway, the AI read Kings Lodge\. Which lodge\?/);
  assert.deepEqual(r.reply.quick?.map((q) => q.text), ["Bandhavgarh at Tree House Hideaway", "Bandhavgarh at Kings Lodge"]);
  const asks = r.reply.checklist?.filter((c) => c.key.startsWith("ask:conflict:")).map((c) => c.key);
  assert.deepEqual(asks, ["ask:conflict:lodge:0", "ask:conflict:nights:1", "ask:conflict:nights:2"]);
  // nothing is priced until the questions are answered
  assert.ok(!r.reply.quick?.some((q) => q.action === "review"));
});

test("a conflict is a question: the answer is applied, then the next question comes", () => {
  let r = first(DELHI_KAZIRANGA, { parsed: aiToParsed(MISREAD, ctx), source: "ai" });
  r = chatTurn(r.plan, r.flags, r.reply.quick![0].text!, ctx, TODAY); // keep Tree House Hideaway
  assert.equal(r.plan.stops[0].property_id, "THH");
  assert.match(r.reply.text, /Kanha: I read 3 nights, the AI read 2/);
  r = chatTurn(r.plan, r.flags, "make Kanha 2 nights", ctx, TODAY); // the AI was right this time
  assert.equal(r.plan.stops[1].nights, 2);
  assert.match(r.reply.text, /Pench: I read 2 nights, the AI read 1/);
});

test("the AI fills only what the reader left empty, and says so", () => {
  const msg = "kanha, 2 adults indian, 16 jan 27, jabalpur in out";
  // the reader reads Kanha with no nights; the AI read 3
  assert.ok(first(msg).flags.nightsUnknown.includes("KAN"));
  const ai = aiToParsed({ stops: [{ park: "Kanha National Park", nights: 3 }], adults: 4 }, ctx);
  const r = first(msg, { parsed: ai, source: "ai" });
  assert.equal(r.plan.stops[0].nights, 3);
  assert.equal(r.plan.guest.adults, 2); // the reader's 2, not the AI's 4...
  assert.match(r.reply.source ?? "", /^AI helped with: nights/);
  assert.ok(r.reply.checklist?.some((c) => c.key === "ask:conflict:adults")); // ...and the difference is asked
});

test("a name the AI gives that is not in master data is dropped and asked about", () => {
  const ai = aiToParsed({ stops: [{ park: "Ranthambore", nights: 2 }, { park: "Kanha National Park", lodge: "Kanha Jungle Palace", nights: 3 }] }, ctx);
  assert.deepEqual(ai.parks.map((p) => [p.name, p.lodge]), [["Kanha National Park", undefined]]);
  assert.deepEqual(ai.asks?.map((a) => a.key), ["unknown:ranthambore", "unknown:kanha jungle palace"]);
  const { asks } = fillGaps({ parks: [], notes: [] }, ai);
  assert.match(asks[0].text, /"Ranthambore" is not in Master data/);
});

test("the AI is asked only when something is missing AND the message has words the reader could not place", () => {
  const r = first("kanha 3 nights");
  const gaps = gapsOf(r.reply.checklist);
  assert.ok(gaps.length > 0);
  // every word read: the missing details were simply not said, so the sales person is asked
  assert.equal(chooseSource({ memoryHit: false, aiOn: true, gaps, unknownWords: unknownWords("kanha 3 nights", ctx), stops: 1 }), "reader");
  assert.equal(chooseSource({ memoryHit: false, aiOn: true, gaps, unknownWords: ["jhakaas"], stops: 1 }), "ai");
  assert.equal(chooseSource({ memoryHit: false, aiOn: false, gaps, unknownWords: ["jhakaas"], stops: 0 }), "reader");
  // a full reading with nothing missing never calls the AI
  assert.equal(chooseSource({ memoryHit: false, aiOn: true, gaps: [], unknownWords: ["jhakaas"], stops: 3 }), "reader");
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

  // the same enquiry again: an exact hit, which wins over a checklist with gaps and the AI switched on
  const key = normaliseEnquiry(DELHI_KAZIRANGA);
  const hit = pickPattern([pattern], key, structureOf(key, TODAY).tokens, TODAY);
  assert.ok(hit?.exact);
  assert.equal(chooseSource({ memoryHit: !!hit, aiOn: true, gaps: gapsOf(first(DELHI_KAZIRANGA).reply.checklist), unknownWords: ["x"], stops: 0 }), "memory");
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
  // 5th may and Pench 4 nights: every old number has one new number
  const next = DELHI_KAZIRANGA.replace("starting 1st april", "starting 5th may").replace("2 nights Pench", "4 nights Pench");
  const key = normaliseEnquiry(next);
  assert.equal(structureOf(key, TODAY).structure, pattern.structure);
  const hit = pickPattern([pattern], key, structureOf(key, TODAY).tokens, TODAY);
  assert.ok(hit && !hit.exact);
  const r = first(next, { parsed: aiToParsed(hit.reading, ctx), source: "memory" });
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "KAN 3 KEL", "PEN 4 PTL", "KAZ 3 IORA"]);
  assert.equal(r.plan.days[0].date, "2027-05-05");
  // Kanha 4 nights: the old "3" would become both 3 and 4, so it is not the same enquiry
  const unclear = normaliseEnquiry(DELHI_KAZIRANGA.replace("3 nights Kanha", "4 nights Kanha"));
  assert.equal(pickPattern([pattern], unclear, structureOf(unclear, TODAY).tokens, TODAY), null);
});

test("the built-in reader alone says so", () => {
  assert.equal(first(DELHI_KAZIRANGA).reply.source, "built-in reader");
});

// Stand-in for the Thompson enquiry (31 Oct 2026): a Delhi night first, then a flight
// Delhi -> Jabalpur; at the end a flight back to Delhi and a Delhi night. The arrival is
// where our car picks them up for the safari part (Jabalpur), so an AI that says
// "Delhi Airport (IGI)" agrees with the reader.
const THOMPSON =
  "Thompson family, 2 adults from UK, 10 feb 1 night delhi, next day fly to jabalpur, kanha 3 nights, bandhavgarh kings lodge 2 nights, back to jabalpur for the flight to delhi, 1 night delhi";
const igi = { ...ctx, locations: ctx.locations.map((l) => (l.id === "DEL" ? { ...l, name: "Delhi Airport (IGI)" } : l)) };
const firstIgi = (msg: string, extra?: Parameters<typeof chatTurn>[5]) => {
  const p = emptyPlan(TODAY);
  return chatTurn(p, initialFlags(p), msg, igi, TODAY, extra);
};

test("a Delhi night and a flight to Jabalpur: the AI's Delhi arrival is no conflict (the Thompson enquiry)", () => {
  const rule = firstIgi(THOMPSON);
  assert.deepEqual([rule.plan.arrival_location_id, rule.plan.departure_location_id], ["JLR", "JLR"]);
  assert.deepEqual(rule.plan.city_stays?.map((c) => [c.when, c.city, c.nights]), [["before", "Delhi", 1], ["after", "Delhi", 1]]);
  const ai = aiToParsed({ arrival_place: "Delhi Airport (IGI)", departure_place: "Delhi Airport (IGI)", stops: [{ park: "Kanha National Park", nights: 3 }, { park: "Bandhavgarh National Park", lodge: "Kings Lodge", nights: 2 }] }, igi);
  assert.equal(ai.arrival_place, "Delhi Airport (IGI)");
  const r = firstIgi(THOMPSON, { parsed: ai, source: "ai" });
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JLR"]);
  const asks = (r.reply.checklist ?? []).map((c) => c.key);
  assert.ok(!asks.includes("ask:conflict:arrival") && !asks.includes("ask:conflict:departure"), asks.join(", "));
  assert.doesNotMatch(r.reply.text, /Where do they arrive|Where does our car pick them up/);
  // with no arrival read, the AI's Delhi is not filled in either (Delhi is before the flight)
  const filled = fillGaps({ ...extractFor(THOMPSON), arrival_place: undefined }, ai).parsed;
  assert.equal(filled.arrival_place, undefined);
});

test("a real arrival disagreement is still asked, as where our car picks them up", () => {
  const ai = aiToParsed({ arrival_place: "Nagpur Airport" }, igi);
  const r = firstIgi(THOMPSON, { parsed: ai, source: "ai" });
  assert.match(r.reply.text, /^Where does our car pick them up for the safari part\? I read Jabalpur Airport, the AI read Nagpur Airport\./);
  assert.deepEqual(r.reply.quick?.map((q) => q.text), ["arrive at Jabalpur Airport", "arrive at Nagpur Airport"]);
});

function extractFor(msg: string) {
  return extractTrip(msg, safariOnly(igi), TODAY, cityHotels(igi));
}
