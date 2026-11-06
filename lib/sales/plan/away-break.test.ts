// A break from our itinerary ("they go to another resort for 2 days and resume with us"):
// nights of their own arrangements between two lodges, on the owner's real Master data. (2 Nov 2026)
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { buildDays, emptyPlan, planToTrip } from "./planner";
import { editStay, isConfirmed, markConfirmed, tripSummary } from "./confirm";
import { quoteChecks } from "./checks";
import { defaultDraft } from "./draft";
import { mergeAiFirst } from "./reading";
import { extractTrip } from "./parse-text";
import { cityHotels } from "./cities";
import { sanitizePlan } from "./sanitize";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { realCtx } from "./real-fixture";
import type { BuilderContext, Plan } from "./types";

const T = "2026-11-02";
function read(c: BuilderContext, ...msgs: string[]) {
  let plan: Plan = emptyPlan(T);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, c, T);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const OWNER =
  "Hi team, pls quote for 2 adults from UK, 1 room, dates not fixed yet. Arrive Delhi 1 night at roseate with delhi sightseeing, local guide and entrances, next day fly to jabalpur, kings lodge 3 nights with village walk and cycling, then they will go with another resort for 2 days and take break from our itinieary than they will resume with us after 2 days then pench 2 nights with culinary workshop and buffer walk, then fly nagpur to delhi and drive direct to agra 2 nights at itc mughal with agra sightseeing and local guide, then drive to jaipur 2 nights at itc rajputana with jaipur sightseeing and accompanying guide, drive back to delhi for homebound flight. all safaris with naturalist";
const name = (p: Plan) => ({ ...p, guest: { ...p.guest, name: "Test" } });
const checksOf = (p: Plan) => {
  const c = markConfirmed(name(p), T);
  return quoteChecks(c, realCtx, priceTrip(planToTrip(c, T), realCtx.pricing)).filter((x) => !/^Price needed/.test(x));
};

test("owner's enquiry: the 2-day break is 2 nights not with us between Kings Lodge and Pench (12 nights, no day missing)", () => {
  const p = read(realCtx, OWNER, "treehouse");
  const away = (p.city_stays ?? []).filter((c) => c.away);
  assert.deepEqual(away.map((c) => [c.nights, c.at, c.city]), [[2, 1, ""]]);
  assert.equal(p.stops.reduce((t, s) => t + s.nights, 0) + (p.city_stays ?? []).reduce((t, c) => t + c.nights, 0), 12);
  // one day per date, Kings Lodge left on day 5, two days of their own, Pench on day 7
  const dates = p.days.map((d) => d.date);
  assert.equal(new Set(dates).size, dates.length);
  assert.equal(p.days.length, 13);
  const kingsOut = p.days.findIndex((d) => d.title === "Own arrangements (2 nights)");
  assert.equal(p.days[kingsOut].text, "After breakfast, check out of Kings Lodge. The next 2 nights are your own arrangements (not included in this itinerary).");
  assert.equal(p.days[kingsOut + 1].title, "Own arrangements");
  assert.equal(p.days[kingsOut + 2].title, "Rejoin at Pench Tree Lodge");
  assert.match(p.days[kingsOut + 2].text, /^After your own arrangements, you rejoin us at Pench Tree Lodge\./);
  // nothing priced for those nights, no transfer, and the quote can be saved (no "no way out / in")
  // (the day they rejoin is a Pench day: its experiences, the culinary workshop asked for, may be on it)
  assert.ok(!p.days.slice(kingsOut, kingsOut + 3).some((d) => d.transfer || d.city_transfers?.length));
  assert.ok(!p.days.slice(kingsOut, kingsOut + 2).some((d) => d.city_hotel || d.items.length));
  assert.deepEqual(checksOf(p), []);
  // the Confirm step says it; the guest's exclusions too
  assert.ok(tripSummary(p, realCtx).some((l) => l.text.endsWith("Not with us: 2 nights (own arrangements, not priced)")));
  assert.ok(defaultDraft(p, { parkNames: {}, lodgeNames: {}, blocks: [], cancellationSlabs: [] }).exclusions.some((x) => x.startsWith("Accommodation, meals and travel during your own arrangements (2 nights not with us)")));
});

test("our car drops and picks up: two transfers to their hotel, prices typed; still no day missing", () => {
  const p0 = read(realCtx, OWNER, "treehouse");
  const k = (p0.city_stays ?? []).findIndex((c) => c.away);
  const p1 = editStay(p0, k, { away_transfer: "ours" });
  const p = { ...p1, days: buildDays(p1, realCtx) };
  const legs = p.days.flatMap((d) => (d.city_transfers ?? []).filter((t) => t.from_label === "their own hotel" || t.to_label === "their own hotel").map((t) => `${t.from_label}>${t.to_label}`));
  assert.deepEqual(legs, ["Kings Lodge>their own hotel", "their own hotel>Pench Tree Lodge"]);
  const r = priceTrip(planToTrip(markConfirmed(p, T), T), realCtx.pricing);
  assert.deepEqual(r.missing.filter((m) => /their own hotel/.test(m.label)).map((m) => m.label), ["Transfer Kings Lodge to their own hotel", "Transfer their own hotel to Pench Tree Lodge"]);
  assert.deepEqual(checksOf(p), []);
});

test("the break survives the server (sanitize) and the confirmation holds", () => {
  const p = markConfirmed(read(realCtx, OWNER, "treehouse"), T);
  const s = sanitizePlan(JSON.parse(JSON.stringify(p)))!;
  assert.deepEqual((s.city_stays ?? []).filter((c) => c.away).map((c) => [c.nights, c.at, c.away_transfer]), [[2, 1, "own"]]);
  assert.ok(isConfirmed(s));
});

test("other ways of saying it; the number before or after the words; ordinary enquiries have no break", () => {
  const away = (msg: string) => (extractTrip(msg, realCtx, T, cityHotels(realCtx)).cityStays ?? []).filter((c) => c.away).map((c) => [c.nights, c.at]);
  assert.deepEqual(away("2 adults, 10 jan 2027, kings lodge 3 nights, then 2 nights at another resort, then pench tree lodge 2 nights"), [[2, 1]]);
  assert.deepEqual(away("2 adults, 10 jan 2027, kanha 3 nights, not with us for 3 nights, then pench 2 nights"), [[3, 1]]);
  assert.deepEqual(away("2 adults, 10 jan 2027, kanha 3 nights then they take a break of 2 days then pench 2 nights"), [[2, 1]]);
  assert.deepEqual(away("2 adults, 10 jan 2027, kanha 3 nights then pench 2 nights"), []);
  assert.deepEqual(away("2 adults, 10 jan 2027, kanha 3 nights then pench 2 nights, they will travel on their own between lodges"), []);
});

test("with AI reading on: the reader's break is kept even when the AI gives the city nights", () => {
  const rule = extractTrip(OWNER, realCtx, T, cityHotels(realCtx));
  const ai = { ...rule, cityStays: (rule.cityStays ?? []).filter((c) => !c.away) };
  const { parsed } = mergeAiFirst(ai, rule);
  assert.deepEqual((parsed.cityStays ?? []).filter((c) => c.away).map((c) => c.nights), [2]);
});
