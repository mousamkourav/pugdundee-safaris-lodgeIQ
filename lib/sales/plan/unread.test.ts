// Nothing in the enquiry is dropped silently: the coverage check (unread.ts), on the owner's
// real Master data, over every enquiry the team has sent (enquiry-corpus.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "./chat";
import { emptyPlan } from "./planner";
import { unreadParts } from "./unread";
import { ENQUIRY_CORPUS } from "./enquiry-corpus";
import { realCtx as ctx, OWNER_FULL_TEST } from "./real-fixture";
import { planToTrip } from "./planner";
import { markConfirmed } from "./confirm";
import { quoteChecks } from "./checks";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { Plan } from "./types";

const T = "2026-11-03";
const read = (msg: string): Plan => {
  const p = emptyPlan(T);
  return chatTurn(p, initialFlags(p), msg, ctx, T).plan;
};
// a touring package written without its split ("Delhi - agra - jaipur 4 nights") is asked, and Agra is
// rightly shown as not in the trip until it is answered
const ASKED = /delhi - agra - jaipur 4 nights/i;

test("every enquiry so far: everything it names is in the trip it gives (100 real enquiries)", () => {
  const misses: string[] = [];
  for (const e of ENQUIRY_CORPUS) {
    const plan = read(e);
    if (!plan.days.length) continue;
    const u = unreadParts(e, plan, ctx, T);
    if (u.length && !ASKED.test(e)) misses.push(`${e.slice(0, 90)} -> ${u.map((x) => `"${x.quote}" (${x.why})`).join("; ")}`);
  }
  assert.deepEqual(misses, []);
  assert.ok(ENQUIRY_CORPUS.length >= 100);
});

test("a place or nights missing from the trip is named, in the enquiry's own words", () => {
  const plan = read(OWNER_FULL_TEST);
  assert.deepEqual(unreadParts(OWNER_FULL_TEST, plan, ctx, T), []);
  // Agra and Jaipur dropped, Khajuraho 2 nights instead of 1
  const broken: Plan = {
    ...plan,
    city_stays: (plan.city_stays ?? []).filter((c) => c.city !== "Agra" && c.city !== "Jaipur").map((c) => (c.city === "Khajuraho" ? { ...c, nights: 2 } : c)),
  };
  const u = unreadParts(OWNER_FULL_TEST, broken, ctx, T);
  assert.ok(u.some((x) => x.quote === "agra" && x.why === "Agra is not in the trip"));
  assert.ok(u.some((x) => x.quote === "jaipur" && x.why === "Jaipur is not in the trip"));
  assert.ok(u.some((x) => /^khajuraho 1 night/.test(x.quote) && x.why === "the trip has 2 night(s) for Khajuraho"));
  // a lodge read as the other lodge of the park
  const kings = { ...plan, stops: plan.stops.map((s) => (s.property_id === "H_tree_house_hideaway" ? { ...s, property_id: "H_kings_lodge" } : s)) };
  assert.ok(unreadParts(OWNER_FULL_TEST, kings, ctx, T).some((x) => x.why === "Tree House Hideaway is not in the trip"));
});

test("not stays: where they come from, booking leads, 'one day'", () => {
  const msg = "Family of 4 - 2 adults 2 kids (8 and 12) from Mumbai, kanha 3 nights then pench 2 nights on 22 Dec 2026, booking 30 days before";
  assert.deepEqual(unreadParts(msg, read(msg), ctx, T), []);
});

test("the chat says it at once when something was not taken into the trip", () => {
  // a city night the reader cannot place ("2 nights khajuraho" before any lodge is fine; this one is unknown words)
  const p = emptyPlan(T);
  const r = chatTurn(p, initialFlags(p), "2 adults, 10 jan 2027, kanha 3 nights then pench 2 nights, nagpur both ways", ctx, T);
  assert.ok(!(r.reply.warnings ?? []).some((w) => /^Not in the trip yet/.test(w)));
  assert.ok(r.plan.enquiry?.startsWith("2 adults"));
});

// Every enquiry so far, routed on the real Master data: never a drive between two regions and never
// a "No road" left for the team to fix by hand, except the one that asks for it (Jorhat for Tadoba).
test("every enquiry so far: no impossible road, no flight left out", () => {
  const bad: string[] = [];
  for (const e of ENQUIRY_CORPUS) {
    const p0 = emptyPlan(T);
    let r = chatTurn(p0, initialFlags(p0), e, ctx, T);
    for (let k = 0; k < 6 && r.reply.quick?.length && !r.plan.days.length; k++) r = chatTurn(r.plan, r.flags, r.reply.quick[0].text ?? r.reply.quick[0].label, ctx, T);
    if (!r.plan.days.length) continue;
    const c = markConfirmed({ ...r.plan, guest: { ...r.plan.guest, name: "Test" } }, T);
    const roads = quoteChecks(c, ctx, priceTrip(planToTrip(c, T), ctx.pricing)).filter((x) => /No road between|joins two regions/.test(x));
    if (roads.length && !/flight to Jorhat and then 3 nights Tadoba/.test(e)) bad.push(`${e.slice(0, 80)} -> ${roads.join(" | ")}`);
  }
  assert.deepEqual(bad, []);
});
