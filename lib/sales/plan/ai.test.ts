// Run with:  npx tsx --test lib/sales/plan/ai.test.ts
// Gemini's answers are simulated here: the tests check what the app does with them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiToParsed, buildPrompt, planToExample, similarExamples } from "./ai";
import { chatTurn, initialFlags } from "./chat";
import { emptyPlan } from "./planner";
import { scrubForAI } from "./parse-text";
import { data } from "@/lib/sales/pricing/sheet-fixture";
import type { BuilderContext } from "./types";

const ctx: BuilderContext = {
  pricing: { ...data, parks: [{ id: "TADOBA", name: "Tadoba-Andhari Tiger Reserve" }, { id: "PENCH", name: "Pench National Park" }] },
  properties: [
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TADOBA", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PENCH", kind: "own_lodge", fallback_priority: 1, sort: 0 },
  ],
  locations: [
    { id: "NAG", name: "Nagpur Airport", type: "airport", property_id: null, code: "NAG" },
    { id: "L_WEL", name: "Waghoba Eco Lodge", type: "property", property_id: "WEL" },
    { id: "L_PTL", name: "Pench Tree Lodge", type: "property", property_id: "PTL" },
  ],
  rooms: [
    { id: "WEL_AC", property_id: "WEL", name: "AC Cottage", sort: 0 },
    { id: "PTL_AC", property_id: "PTL", name: "AC Cottage", sort: 0 },
  ],
  templates: [],
  content: [],
  cancellation: [],
};
const TODAY = "2026-10-05";

// What Gemini might answer for: "2 log aa rahe hai 16 jan ko nagpur, pehle tadoba 4 raat phir pench 3 raat, sab safari naturalist ke saath, wapas nagpur se"
const HINGLISH = "2 log aa rahe hai 16 jan ko nagpur, pehle tadoba 4 raat phir pench 3 raat, sab safari naturalist ke saath, wapas nagpur se";
const GEMINI_ANSWER = {
  replace_route: true,
  adults: 2,
  rooms: null,
  country: "IN",
  arrival_date: "2027-01-16",
  arrival_place: "Nagpur Airport",
  departure_place: "Nagpur Airport",
  stops: [
    { park: "Tadoba-Andhari Tiger Reserve", lodge: null, nights: 4, room: null, safaris: null, naturalists: -1, extras: [] },
    { park: "Pench National Park", lodge: "Pench Tree Lodge", nights: 3, room: null, safaris: null, naturalists: -1, extras: ["bush dinner", "made up thing"] },
    { park: "Kaziranga National Park", nights: 2 }, // not in our data: dropped
  ],
  flights: [],
  city_stays: [],
};

test("a Hinglish enquiry: the built-in reader reads it too, the AI's answer builds the trip", () => {
  const plan = emptyPlan(TODAY);
  const rulesOnly = chatTurn(plan, initialFlags(plan), HINGLISH, ctx, TODAY);
  // the fallback when the AI is off or over its limit
  assert.deepEqual(rulesOnly.plan.stops.map((s) => [s.park_id, s.nights]), [["TADOBA", 4], ["PENCH", 3]]);
  assert.equal(rulesOnly.plan.guest.adults, 2);
  const ai = aiToParsed(GEMINI_ANSWER, ctx);
  assert.equal(ai.parks.length, 2); // Kaziranga dropped
  assert.deepEqual(ai.parks[1].extras, ["bush dinner"]); // unknown experience dropped
  const r = chatTurn(plan, initialFlags(plan), HINGLISH, ctx, TODAY, ai, { aiPrimary: true });
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights]), [["TADOBA", 4], ["PENCH", 3]]);
  assert.equal(r.plan.arrival_location_id, "NAG");
  assert.equal(r.plan.departure_location_id, "NAG");
  assert.equal(r.plan.guest.country, "IN");
  assert.equal(r.plan.guest.adults, 2);
  // every safari with a naturalist, as asked
  const saf = r.plan.days.flatMap((d) => d.safaris);
  assert.ok(saf.length > 0 && saf.every((s) => s.naturalist));
});

test("AI corrections: remove a park, a new order, a whole new route", () => {
  let plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), HINGLISH, ctx, TODAY, aiToParsed(GEMINI_ANSWER, ctx), { aiPrimary: true });
  plan = r.plan;
  r = chatTurn(plan, r.flags, "pench pehle karo", ctx, TODAY, aiToParsed({ order: ["Pench National Park", "Tadoba-Andhari Tiger Reserve"] }, ctx), { aiPrimary: true });
  assert.deepEqual(r.plan.stops.map((s) => s.park_id), ["PENCH", "TADOBA"]);
  r = chatTurn(r.plan, r.flags, "tadoba hata do", ctx, TODAY, aiToParsed({ remove_parks: ["Tadoba-Andhari Tiger Reserve"] }, ctx), { aiPrimary: true });
  assert.deepEqual(r.plan.stops.map((s) => s.park_id), ["PENCH"]);
  r = chatTurn(r.plan, r.flags, "new plan: tadoba 2 nights only", ctx, TODAY, aiToParsed({ replace_route: true, stops: [{ park: "Tadoba-Andhari Tiger Reserve", nights: 2 }] }, ctx), { aiPrimary: true });
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights]), [["TADOBA", 2]]);
});

test("a lodge on its own is enough; city stays with hotel; bad values are ignored", () => {
  const p = aiToParsed(
    {
      stops: [{ lodge: "Waghoba Eco Lodge", nights: 99, safaris: -3 }],
      city_stays: [{ when: "before", city: "Delhi", nights: 1, hotel: "The Imperial", price: 18000 }, { when: "sometime", city: "X", nights: 1 }],
      flights: [{ from: "Delhi", to: "Nagpur", time: "08.30" }, { from: "Delhi", to: "Delhi" }],
      arrival_place: "Moon Airport",
    },
    ctx
  );
  assert.equal(p.parks[0].name, "Tadoba-Andhari Tiger Reserve");
  assert.equal(p.parks[0].lodge, "Waghoba Eco Lodge");
  assert.equal(p.parks[0].nights, undefined); // 99 nights is not sensible
  assert.equal(p.parks[0].safaris, undefined);
  assert.deepEqual(p.cityStays, [{ when: "before", city: "Delhi", nights: 1, hotel: "The Imperial", price: 18000 }]);
  assert.deepEqual(p.flights, [{ from: "Delhi", to: "Nagpur", time: "08:30" }]);
  assert.equal(p.arrival_place, undefined);
});

test("the prompt carries our data and similar past quotes, never guest names", () => {
  const plan = emptyPlan(TODAY);
  const prompt = buildPrompt({
    message: "Mr Wilson and family, 4 pax, tadoba 3n. email a@b.com, +44 7700 900123",
    history: [],
    plan,
    ctx,
    glossary: [{ term: "WEL", meaning: "Waghoba Eco Lodge" }],
    examples: [{ message: "2 pax tadoba 3n pench 2n", expected: "{}" }],
    today: TODAY,
  });
  assert.match(prompt, /Tadoba-Andhari Tiger Reserve: Waghoba Eco Lodge \(rooms: AC Cottage\)/);
  assert.match(prompt, /WEL = Waghoba Eco Lodge/);
  assert.match(prompt, /2 pax tadoba 3n pench 2n/);
  assert.doesNotMatch(prompt, /Wilson|a@b\.com|7700/);
  assert.match(scrubForAI("for Mrs Sharma, 2 adults"), /\[guest\]/);
});

test("the guest's name from the guest fields never reaches the AI, even without Mr/Mrs", () => {
  const plan = { ...emptyPlan(TODAY), guest: { ...emptyPlan(TODAY).guest, name: "Sangeeta Kapoor" } };
  const prompt = buildPrompt({
    message: "Sangeeta and family, 3 pax, tadoba 3n",
    history: [{ role: "user", text: "quote for KAPOOR ji please" }],
    plan,
    ctx,
    glossary: [],
    examples: [],
    today: TODAY,
  });
  assert.doesNotMatch(prompt, /sangeeta|kapoor/i);
  assert.match(prompt, /\[guest\] and family, 3 pax, tadoba 3n/);
  // parks and lodges are untouched, and short words are never taken for a name
  assert.equal(scrubForAI("Al wants Kanha 2 nights", ["Al"]), "Al wants Kanha 2 nights");
  assert.equal(scrubForAI("Kanha 2 nights for the Kapoors, Kapoor's daughter too", ["Kapoor"]), "Kanha 2 nights for the [guest], [guest] daughter too");
});

test("learning: a saved quote becomes an example, and similar enquiries find it", () => {
  const plan = emptyPlan(TODAY);
  const r = chatTurn(plan, initialFlags(plan), HINGLISH, ctx, TODAY, aiToParsed(GEMINI_ANSWER, ctx), { aiPrimary: true });
  const ex = JSON.parse(planToExample(r.plan, ctx));
  assert.deepEqual(ex.stops.map((s: { park: string; nights: number }) => [s.park, s.nights]), [["Tadoba-Andhari Tiger Reserve", 4], ["Pench National Park", 3]]);
  const all = [
    { message: HINGLISH, expected: "A" },
    { message: "family of 5 kanha bandhavgarh jabalpur in out", expected: "B" },
  ];
  assert.equal(similarExamples(all, "3 log tadoba 2 raat phir pench 2 raat nagpur se")[0].expected, "A");
});
