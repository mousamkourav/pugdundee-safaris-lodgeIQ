// The AI's full form (3 Nov 2026): dates not fixed, breaks, where the trip ends and wishes for the
// whole trip come from the AI too, through the evidence rule; on the owner's real Master data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "./chat";
import { emptyPlan } from "./planner";
import { aiToParsed, buildPrompt } from "./ai";
import { checkEvidence } from "./evidence";
import { mergeAiFirst } from "./reading";
import { extractTrip } from "./parse-text";
import { realCtx as ctx } from "./real-fixture";

const T = "2026-11-03";
const V = (value: unknown, quote: string) => ({ value, quote });
const MSG =
  "2 adults from UK, dates are not fixed yet. kanha 3 nights then they will go to another resort for 2 days and resume with us, then pench 2 nights, then drive back to delhi for the flight home. they will do safaris with naturalists and want all the unique experiences that we offer like cycling, walking";
const ANSWER = {
  adults: V(2, "2 adults"),
  country: V("GB", "from UK"),
  dateless: V(true, "dates are not fixed yet"),
  stops: [
    { park: V("Kanha National Park", "kanha 3 nights"), nights: V(3, "kanha 3 nights") },
    { park: V("Pench National Park", "pench 2 nights"), nights: V(2, "pench 2 nights") },
  ],
  breaks: [{ at: 1, nights: V(2, "another resort for 2 days"), quote: "go to another resort for 2 days and resume with us" }],
  end_city: V("Delhi", "drive back to delhi for the flight home"),
  trip_wide: { naturalists: V(-1, "safaris with naturalists"), extras: [V("special", "all the unique experiences"), V("cycling", "like cycling"), V("nature walk", "walking")] },
};

test("the AI's full form is kept by the evidence rule and becomes the trip", () => {
  const { reading, dropped } = checkEvidence(ANSWER, MSG, ctx);
  assert.deepEqual(dropped, []);
  const parsed = aiToParsed(reading, ctx);
  assert.equal(parsed.dateless, true);
  assert.equal(parsed.endCity, "Delhi");
  assert.deepEqual(parsed.cityStays?.map((c) => [c.nights, c.at, c.away]), [[2, 1, true]]);
  assert.deepEqual(parsed.parks.map((p) => [p.name, p.naturalists, p.extras]), [
    ["Kanha National Park", -1, ["special", "cycling", "nature walk"]],
    ["Pench National Park", -1, ["special", "cycling", "nature walk"]],
  ]);
  const p0 = emptyPlan(T);
  const r = chatTurn(p0, initialFlags(p0), MSG, ctx, T, { parsed, source: "ai" });
  assert.equal(r.plan.dateless, true);
  assert.equal(r.plan.end_city, "Delhi");
  assert.deepEqual((r.plan.city_stays ?? []).filter((c) => c.away).map((c) => c.nights), [2]);
});

test("a break, an end or a dateless the message does not say is thrown away", () => {
  const bad = {
    dateless: V(true, "2 adults from UK"),
    end_city: V("Agra", "pench 2 nights"),
    breaks: [{ at: 1, nights: V(2, "pench 2 nights"), quote: "pench 2 nights" }],
    trip_wide: { naturalists: V(-1, "kanha 3 nights") },
  };
  const { reading, dropped } = checkEvidence(bad, MSG, ctx);
  assert.deepEqual(Object.keys(reading), []);
  assert.deepEqual(dropped.map((d) => d.field).sort(), ["breaks[0]", "dateless", "end_city", "trip_wide.naturalists"]);
});

test("the prompt asks for every place and night, and for the new parts of the form", () => {
  const prompt = buildPrompt({ message: MSG, history: [], plan: emptyPlan(T), ctx, glossary: [], examples: [], today: T });
  for (const w of ['"dateless"', '"breaks"', '"end_city"', '"trip_wide"', "Every place and every"]) assert.ok(prompt.includes(w), w);
});

test("the AI and the reader read different nights: one question; its answer sets the nights", () => {
  const msg = "2 adults from UK, 10 jan 2027, tadoba 3 nights at waghoba, nagpur both ways";
  const wrong = { stops: [{ park: V("Tadoba-Andhari Tiger Reserve", "tadoba 3 nights"), lodge: V("Waghoba Eco Lodge", "waghoba"), nights: V(2, "tadoba 3 nights") }] };
  // the evidence rule throws away a "2" the quote does not say; an AI that quotes it right agrees
  assert.equal(checkEvidence(wrong, msg, ctx).dropped[0]?.field, "stops[0].nights");
  const rule = extractTrip(msg, ctx, T);
  const { parsed } = mergeAiFirst({ ...rule, parks: rule.parks.map((p) => ({ ...p, nights: 2 })) }, rule);
  const p0 = emptyPlan(T);
  const r = chatTurn(p0, initialFlags(p0), msg, ctx, T, { parsed, source: "ai" });
  assert.match(r.reply.text, /^Waghoba Eco Lodge: 2 or 3 nights\?/);
  const r2 = chatTurn(r.plan, r.flags, "Waghoba Eco Lodge 3 nights", ctx, T);
  assert.equal(r2.plan.stops[0].nights, 3);
});
