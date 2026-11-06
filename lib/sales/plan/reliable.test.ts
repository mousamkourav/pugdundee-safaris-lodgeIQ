// Run with:  npx tsx --test lib/sales/plan/reliable.test.ts
// The owner's "make the itinerary system reliable" request (5 Nov 2026): the known bugs, each kept
// fixed by a test, on the REAL Master data (export of 5 Nov 2026, real-fixture.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan, planToTrip } from "./planner";
import { markConfirmed } from "./confirm";
import { quoteChecks } from "./checks";
import { checkEvidence } from "./evidence";
import { aiToParsed } from "./ai";
import { guestWords } from "./travel-rules";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { realCtx as ctx } from "./real-fixture";
import type { Plan } from "./types";

const T = "2026-11-06";
const V = (value: unknown, quote: string) => ({ value, quote });
const nm = (id: string | null | undefined) => (!id ? "-" : ctx.locations.find((l) => l.id === id)?.name ?? ctx.properties.find((p) => p.id === id)?.name ?? id);
function say(...msgs: (string | { msg: string; ai: unknown })[]) {
  let plan: Plan = emptyPlan(T);
  let flags: ChatFlags = initialFlags(plan);
  let r = chatTurn(plan, flags, "", ctx, T);
  for (const m of msgs) {
    const msg = typeof m === "string" ? m : m.msg;
    const extra = typeof m === "string" ? undefined : { parsed: aiToParsed(checkEvidence(m.ai, msg, ctx).reading, ctx), source: "ai" as const };
    r = chatTurn(plan, flags, msg, ctx, T, extra);
    plan = r.plan;
    flags = r.flags;
  }
  return r;
}
// every drive and flight of the trip, in order: "03-30 drive Kanha Earth Lodge>Jabalpur Airport"
const legs = (p: Plan) =>
  p.days.flatMap((d) => [
    ...(d.transfer ? [`${d.date.slice(5)} drive ${nm(d.transfer.from_location_id)}>${nm(d.transfer.to_location_id)}`] : []),
    ...(d.city_transfers ?? []).map((t) => `${d.date.slice(5)} car ${t.from_label || nm(t.from_location_id)}>${t.to_label || nm(t.to_location_id)}`),
    ...d.items.filter((i) => i.type === "flight").map((i) => `${d.date.slice(5)} ${i.title}`),
  ]);
const quote = (p: Plan) => {
  const c = markConfirmed(p, T);
  const r = priceTrip(planToTrip(c, T), ctx.pricing);
  return { r, checks: quoteChecks(c, ctx, r) };
};

// ---------------------------------------------------------------- bug 1

const BUG1 =
  "1 double from America starting 20th March 2027, 1 night delhi, flight to Bhopal, 3 nights denwa backwater escape, transfer to pench, 3 nights pench tree lodge, transfer to Kanha, 3 nights kanha earth lodge, transfer to Jabalpur and flight to delhi, 1 night delhi,";

test("bug 1: '1 double' is 2 adults in 1 room (never 'How many guests?'); the last Delhi night by its own airport", () => {
  const r = say(BUG1);
  assert.deepEqual([r.plan.guest.adults, r.plan.guest.rooms], [2, 1]);
  assert.doesNotMatch(r.reply.text, /How many guests/);
  const l = legs(r.plan);
  // Example 2 of the rule book: Kanha > Jabalpur Airport, flight Jabalpur > Delhi, Delhi Airport > Roseate, Roseate > Delhi Airport
  assert.ok(l.includes("03-30 drive Kanha Earth Lodge>Jabalpur Airport"), l.join("\n"));
  assert.ok(l.includes("03-30 Flight Jabalpur to Delhi"), l.join("\n"));
  assert.ok(l.includes("03-30 car Delhi Airport (IGI)>Roseate House"), l.join("\n"));
  assert.ok(l.includes("03-31 car Roseate House>Delhi Airport (IGI)"), l.join("\n"));
  assert.ok(!l.some((x) => /Roseate House>Jabalpur/.test(x)), "never a Delhi hotel to Jabalpur Airport");
  // and the start: Delhi Airport > Roseate, Roseate > Delhi Airport, flight Delhi > Bhopal, Bhopal Airport > Denwa (Example 1)
  assert.ok(["03-20 car Delhi Airport (IGI)>Roseate House", "03-21 car Roseate House>Delhi Airport (IGI)", "03-21 Flight Delhi to Bhopal", "03-21 drive Bhopal Airport>Denwa Backwater Escape"].every((x) => l.includes(x)), l.join("\n"));
  // every flight at Rs 15,000 per person, nothing left to type
  const { r: priced } = quote(r.plan);
  assert.deepEqual(priced.lines.filter((x) => /^Flight /.test(x.description)).map((x) => x.amount), [30_000, 30_000]);
  assert.deepEqual(priced.missing.map((m) => m.label), []);
});

test("bug 1 (AI side): the evidence rule takes '1 double' as the quote for 2 adults and 1 room", () => {
  const { reading, dropped } = checkEvidence({ adults: V(2, "1 double"), rooms: V(1, "1 double") }, BUG1, ctx);
  assert.deepEqual(dropped, []);
  assert.deepEqual([reading.adults, reading.rooms], [2, 1]);
  // but a number the words do not state is still dropped
  assert.equal(checkEvidence({ adults: V(3, "1 double") }, BUG1, ctx).dropped.length, 1);
});

test("guest words: double, twin, triple, single, couple, honeymoon, family of 4", () => {
  assert.deepEqual(guestWords("1 double from UK"), { adults: 2, rooms: 1, quote: "1 double" });
  assert.deepEqual(guestWords("2 doubles"), { adults: 4, rooms: 2, quote: "2 doubles" });
  assert.deepEqual(guestWords("1 triple + 1 double"), { adults: 5, rooms: 2, quote: "1 triple + 1 double" });
  assert.deepEqual(guestWords("one twin room"), { adults: 2, rooms: 1, quote: "one twin" });
  assert.deepEqual(guestWords("single traveller"), { adults: 1, rooms: 1, quote: "single traveller" });
  assert.deepEqual(guestWords("honeymoon couple"), { adults: 2, quote: "honeymoon" });
  assert.deepEqual(guestWords("family of 4"), { family: 4, quote: "family of 4" });
  // a room type or a supplement is not a guest count
  assert.equal(guestWords("2 adults, double bed, single supplement"), null);
  const r = say("2 doubles from Germany, kanha 2 nights kanha earth lodge 10 feb 2027, jabalpur in out");
  assert.deepEqual([r.plan.guest.adults, r.plan.guest.rooms], [4, 2]);
});

// ---------------------------------------------------------------- bug 2, 3, 4

test("bug 2: '2 bacche (7 aur 12 saal)' are children of 7 and 12; no New Year question in February", () => {
  const r = say("2 adults + 2 bacche (7 aur 12 saal) indian, kanha 3 nights 10 feb 2027, jabalpur in out");
  assert.deepEqual([r.plan.guest.adults, r.plan.guest.children], [2, [7, 12]]);
  assert.ok(!(r.flags.asks ?? []).some((a) => a.key.startsWith("newyear")));
  assert.doesNotMatch(r.reply.text, /New Year/);
});

test("bug 3: misspelt nights, safaris, adults ('3 nigths waghoba with 4 safaries', '2 adluts')", () => {
  const r = say("2 adluts from UK, 3 nigths waghoba with 4 safaries, 12 feb 2027, nagpur in out");
  assert.equal(r.plan.guest.adults, 2);
  assert.deepEqual(r.plan.stops.map((s) => [nm(s.property_id), s.nights, s.want_safaris]), [["Waghoba Eco Lodge", 3, 4]]);
});

test("bug 4: a city hotel named alone mid-trip ('1 night roseate again') is a Delhi night, with its flights", () => {
  const r = say("2 adults from UK, 12 feb 2027, 1 night delhi at roseate, fly to nagpur, pench 2 nights, fly to delhi, 1 night roseate again, fly to jorhat, iora 2 nights, fly jorhat to delhi");
  assert.deepEqual(r.plan.stops.map((s) => [nm(s.property_id), s.nights]), [["Pench Tree Lodge", 2], ["Iora Retreat", 2]]);
  assert.deepEqual((r.plan.city_stays ?? []).map((c) => [c.city, c.nights, c.at ?? null]), [["Delhi", 1, null], ["Delhi", 1, 1]]);
  const l = legs(r.plan);
  assert.ok(["02-15 Flight Nagpur to Delhi", "02-15 car Delhi Airport (IGI)>Roseate House", "02-16 car Roseate House>Delhi Airport (IGI)", "02-16 Flight Delhi to Jorhat", "02-18 Flight Jorhat to Delhi"].every((x) => l.includes(x)), l.join("\n"));
});

test("'iora 2 nights' alone is Iora Retreat; 'fly jorhat to delhi' after it is the way home, not the way in", () => {
  const r = say("2 adults from UK, 12 feb 2027, pench 2 nights, fly to jorhat, iora 2 nights, fly jorhat to delhi");
  assert.deepEqual(r.plan.stops.map((s) => nm(s.property_id)), ["Pench Tree Lodge", "Iora Retreat"]);
  assert.deepEqual(r.plan.flights, [{ from: "Nagpur", to: "Jorhat" }, { from: "Jorhat", to: "Delhi" }]);
  assert.equal(r.plan.departure_location_id, "L_jorhat_airport");
  // where they arrive is not written: asked, Pench's nearest airport (Nagpur, 3 h) offered first
  assert.equal(r.plan.arrival_location_id, null);
  assert.match(r.reply.text, /Where will they arrive/);
  assert.equal(r.reply.quick?.[0]?.label, "Nagpur Airport");
});

// ---------------------------------------------------------------- bug 5

test("bug 5: Pench then Kaziranga is never a road; the Kaziranga airport (Jorhat or Guwahati) is asked once", () => {
  let r = say("2 adults from UK, arriving nagpur 12 feb 2027, pench 2 nights pench tree lodge, then kaziranga 2 nights iora");
  assert.ok(!legs(r.plan).some((x) => /drive Pench Tree Lodge>Iora Retreat/.test(x)));
  assert.ok(legs(r.plan).some((x) => /Flight Nagpur to (Guwahati|Jorhat)/.test(x)));
  // never Nagpur as the way out of Iora Retreat (no flight back to Nagpur nobody wrote)
  assert.ok(!legs(r.plan).some((x) => /Flight (Guwahati|Jorhat) to Nagpur/.test(x)), legs(r.plan).join("\n"));
  const ask = (r.flags.asks ?? []).filter((a) => a.key === "airport:Kaziranga National Park");
  assert.equal(ask.length, 1);
  r = say("2 adults from UK, arriving nagpur 12 feb 2027, pench 2 nights pench tree lodge, then kaziranga 2 nights iora", "jorhat");
  assert.ok(legs(r.plan).some((x) => /Flight Nagpur to Jorhat/.test(x)), legs(r.plan).join("\n"));
  assert.ok(!(r.flags.asks ?? []).some((a) => a.key === "airport:Kaziranga National Park"), "asked once, then answered");
  // Jorhat / Guwahati only for Iora Retreat: never the airport of a Central India lodge
  const c = say("2 adults from UK, arriving nagpur 12 feb 2027, pench 2 nights, kanha 2 nights, jabalpur out");
  assert.ok(!legs(c.plan).some((x) => /Jorhat|Guwahati/.test(x)));
});

// ---------------------------------------------------------------- bug 6, 7

test("bug 6: Tadoba core more than 120 days ahead is priced at the 60-120 day rate (Indian and foreign)", () => {
  // booked 6 Nov 2026 for Wed 21 Apr 2027: 166 days ahead
  const safaris = (who: string) =>
    quote(say(`2 adults ${who}, tadoba 2 nights waghoba from 20 apr 2027, nagpur in out`).plan).r.lines.filter((l) => l.kind === "safari").map((l) => l.amount);
  assert.deepEqual(safaris("indian"), [14_700, 14_700]); // 14,000 (the 60-120 day row) + 5%
  assert.deepEqual(safaris("from UK"), [15_225, 15_225]); // 14,500 + 5%
});

test("bug 7: Indian guests get the published Indian tariff; the BAR rows are for foreign guests", () => {
  const rooms = (who: string) =>
    quote(say(`2 adults ${who}, pench 2 nights pench tree lodge from 10 feb 2027, nagpur in out`).plan).r.lines.filter((l) => l.kind === "room").map((l) => l.amount);
  assert.deepEqual(rooms("indian"), [23_010, 23_010]); // 19,500 (Indian, High, Wed / Thu) + 18%
  assert.deepEqual(rooms("from UK"), [25_960, 25_960]); // 22,000 (BAR, High) + 18%
});

// ---------------------------------------------------------------- bug 8

test("bug 8: the AI and the reader agreeing asks nothing more; nothing like 'I read X, the AI read Y'", () => {
  const msg = "1 double from UK, kanha 3 nights kanha earth lodge from 10 feb 2027, jabalpur in out";
  const ai = {
    adults: V(2, "1 double"),
    rooms: V(1, "1 double"),
    country: V("GB", "from UK"),
    arrival_date: V("2027-02-10", "from 10 feb 2027"),
    stops: [{ park: V("Kanha National Park", "kanha 3 nights"), nights: V(3, "kanha 3 nights"), lodge: V("Kanha Earth Lodge", "kanha earth lodge") }],
    arrival_place: V("Jabalpur Airport", "jabalpur in out"),
    departure_place: V("Jabalpur Airport", "jabalpur in out"),
  };
  const r = say({ msg, ai });
  assert.deepEqual([r.plan.guest.adults, r.plan.guest.rooms], [2, 1]);
  assert.deepEqual((r.flags.asks ?? []).map((a) => a.key), []);
  assert.doesNotMatch(r.reply.text, /How many guests|the AI read|I read/);
  assert.match(r.reply.text, /Total/);
});

// ---------------------------------------------------------------- flights: never a silent 0

test("a flight with no route row takes the domestic fare; a fare cleared by hand is a price to type, never 0", () => {
  // no row in Flight routes: the Sales setting (Rs 15,000) is the fare
  const bare = { ...ctx, flightRoutes: [] };
  let plan: Plan = emptyPlan(T);
  plan = chatTurn(plan, initialFlags(plan), BUG1, bare, T).plan;
  assert.deepEqual(plan.days.flatMap((d) => d.items.filter((i) => i.type === "flight").map((i) => i.flight?.fare_pp)), [15_000, 15_000]);
  const p = say(BUG1).plan;
  // a flight item whose fare was cleared by hand: a price to type, and the quote cannot go to the guest
  const cleared: Plan ={ ...p, days: p.days.map((d) => ({ ...d, items: d.items.map((i) => (i.type === "flight" ? { ...i, price: null, flight: { ...i.flight!, fare_pp: null } } : i)) })) };
  const c = markConfirmed(cleared, T);
  const r = priceTrip(planToTrip(c, T), ctx.pricing);
  assert.deepEqual(r.missing.filter((m) => /Flight/.test(m.label)).length, 2);
  assert.ok(quoteChecks(c, ctx, r).some((x) => /^Price needed: Flight /.test(x)));
});
