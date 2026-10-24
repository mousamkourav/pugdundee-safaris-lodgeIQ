// Run with:  npx tsx --test lib/sales/plan/chat.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { emptyPlan } from "./planner";
import { data } from "@/lib/sales/pricing/sheet-fixture";
import type { BuilderContext, Plan } from "./types";

const ctx: BuilderContext = {
  pricing: data,
  properties: [
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TADOBA", kind: "own_lodge", fallback_priority: 1, sort: 0 },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PENCH", kind: "own_lodge", fallback_priority: 1, sort: 0 },
  ],
  locations: [
    { id: "NAG", name: "Nagpur Airport", type: "airport", property_id: null },
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

function conversation() {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  return (msg: string) => {
    const r = chatTurn(plan, flags, msg, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return { ...r, plan };
  };
}

test("a step-by-step conversation that asks for each missing detail", () => {
  const say = conversation();
  let r = say("Tadoba 4 nights then Pench 3 nights");
  assert.equal(r.plan.stops.length, 2);
  assert.match(r.reply.text, /When do they arrive/);
  r = say("16 Jan 2027");
  assert.equal(r.plan.arrival_date, "2027-01-16");
  assert.match(r.reply.text, /How many guests/);
  r = say("2 adults, 2 rooms");
  assert.match(r.reply.text, /Where will they arrive/);
  assert.ok(r.reply.quick?.some((q) => q.label === "Nagpur Airport"));
  r = say("Nagpur");
  assert.equal(r.plan.arrival_location_id, "NAG");
  // the way out is asked separately, never assumed
  assert.equal(r.plan.departure_location_id, null);
  assert.match(r.reply.text, /Where do they leave from/);
  r = say("same");
  assert.equal(r.plan.departure_location_id, "NAG");
  assert.match(r.reply.text, /Total .*5,58,670/);
  assert.match(r.reply.text, /guest's name/);
  r = say("Judy & Cathy Miller");
  assert.equal(r.plan.guest.name, "Judy & Cathy Miller");
  assert.equal(r.plan.days.length, 8);
  assert.ok(r.reply.quick?.some((q) => q.action === "review"));
});

test("everything in one message is priced straight away", () => {
  const say = conversation();
  const r = say("2 adults in 2 rooms, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, Nagpur out");
  assert.match(r.reply.text, /5,58,670/);
});

test("changes in plain words: nights, add, remove, instead of, start over", () => {
  const say = conversation();
  say("2 adults in 2 rooms, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, Nagpur out");
  let r = say("make Pench 2 nights");
  assert.equal(r.plan.stops.find((s) => s.park_id === "PENCH")!.nights, 2);
  assert.equal(r.plan.days.length, 7); // day plan rebuilt
  r = say("remove Pench");
  assert.deepEqual(r.plan.stops.map((s) => s.park_id), ["TADOBA"]);
  r = say("add Pench");
  assert.match(r.reply.text, /How many nights in Pench/);
  r = say("3");
  assert.equal(r.plan.stops.find((s) => s.park_id === "PENCH")!.nights, 3);
  r = say("3 adults");
  assert.equal(r.plan.guest.adults, 3);
  assert.equal(r.plan.guest.rooms, 2); // rooms were set explicitly, so they stay
  r = say("start over");
  assert.equal(r.plan.stops.length, 0);
});

test("quick-reply buttons and a name typed at any time", () => {
  const say = conversation();
  say("Tadoba 4 nights then Pench 3 nights");
  say("16 Jan 2027");
  let r = say("2 adults");
  const nag = r.reply.quick!.find((q) => q.label === "Nagpur Airport")!;
  r = say(nag.text!);
  assert.equal(r.plan.arrival_location_id, "NAG");
  assert.equal(r.plan.departure_location_id, null);
  const same = r.reply.quick!.find((q) => q.label.startsWith("Same"))!;
  r = say(same.text!);
  assert.equal(r.plan.departure_location_id, "NAG");
  const say2 = conversation();
  say2("Tadoba 2 nights");
  r = say2("Judy & Cathy Miller");
  assert.equal(r.plan.guest.name, "Judy & Cathy Miller");
  r = say2("hello there");
  assert.match(r.reply.text, /did not catch/);
});

test("a name at the start of the enquiry", () => {
  const say = conversation();
  const r = say("Mr Shah, 2 adults, Tadoba 3 nights");
  assert.equal(r.plan.guest.name, "Mr Shah");
  const say2 = conversation();
  const r2 = say2("Mr Shah from UK, 2 adults, Tadoba 3 nights, +44 7400 123456");
  assert.equal(r2.plan.guest.name, "Mr Shah");
  assert.equal(r2.plan.guest.country, "GB");
  assert.equal(r2.plan.guest.nationality, "foreign");
  assert.equal(r2.plan.guest.phone, "+447400123456");
  assert.equal(r.plan.guest.adults, 2);
});

test("contact details and names in the message", () => {
  const say = conversation();
  const r = say("for Mrs. Anderson, judy@example.com, +44 7700 900123, Tadoba 3 nights");
  assert.equal(r.plan.guest.name, "Mrs. Anderson");
  assert.equal(r.plan.guest.email, "judy@example.com");
  assert.ok(r.plan.guest.phone.includes("7700"));
});

test("problems are explained, not hidden", () => {
  const noTransfers = { ...ctx, pricing: { ...ctx.pricing, transferRates: [] } };
  let plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), "2 adults, arriving Nagpur 16 Jan 2027, Tadoba 4 nights, Nagpur out", noTransfers, TODAY);
  // missing transfer prices do not block: total so far, and what is still needed
  assert.match(r.reply.text, /Total so far/);
  assert.ok(r.reply.warnings!.some((w) => w.includes("not in master data") && w.includes("Transfer Nagpur Airport to Waghoba Eco Lodge")));
  assert.ok(r.reply.quick!.some((q) => q.action === "review"));
  r = chatTurn(r.plan, r.flags, "on their own", noTransfers, TODAY);
  assert.equal(r.plan.arrival_location_id, null);
  assert.match(r.reply.text, /Total/);
  plan = emptyPlan(TODAY);
  r = chatTurn(plan, initialFlags(plan), "hello there", ctx, TODAY);
  assert.match(r.reply.text, /did not catch/);
});

test("asks Cottage or Tree House where a lodge has both; asks the way out separately", () => {
  const treeCtx = { ...ctx, rooms: [...ctx.rooms, { id: "PTL_T", property_id: "PTL", name: "AC Treehouse", sort: 1 }], pricing: { ...ctx.pricing, roomRates: [...ctx.pricing.roomRates, ...ctx.pricing.roomRates.filter((r) => r.room_category_id === "PTL_AC").map((r) => ({ ...r, id: r.id + "_T", room_category_id: "PTL_T" }))] } };
  let plan = emptyPlan(TODAY);
  let flags = initialFlags(plan);
  const say = (m: string) => {
    const r = chatTurn(plan, flags, m, treeCtx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
  let r = say("2 adults, Indian, 16 Jan 2027, arriving at Nagpur, Tadoba 4 nights then Pench 3 nights");
  assert.match(r.reply.text, /Where do they leave from/);
  r = say("leaving on their own");
  assert.equal(plan.departure_location_id, null);
  assert.equal(plan.arrival_location_id, "NAG"); // only the way out was cleared
  assert.match(r.reply.text, /Cottage or Tree ?house at Pench Tree Lodge/i);
  r = say("tree house");
  assert.equal(plan.stops[1].room_category_id, "PTL_T");
  assert.doesNotMatch(r.reply.text, /Cottage or Tree ?house/i);
});

test("a lodge with four room types: asks with their names; forest suite / deluxe room understood", () => {
  const four = [
    { id: "PTL_C", property_id: "PTL", name: "AC Cottage", sort: 0 },
    { id: "PTL_T", property_id: "PTL", name: "AC Treehouse", sort: 1 },
    { id: "PTL_S", property_id: "PTL", name: "Forest Suite", sort: 2 },
    { id: "PTL_D", property_id: "PTL", name: "Deluxe Room", sort: 3 },
  ];
  const base = ctx.pricing.roomRates.filter((r) => r.room_category_id === "PTL_AC");
  const c4 = { ...ctx, rooms: [...ctx.rooms.filter((r) => r.property_id !== "PTL"), ...four], pricing: { ...ctx.pricing, roomRates: [...ctx.pricing.roomRates, ...four.flatMap((rm) => base.map((r) => ({ ...r, id: r.id + rm.id, room_category_id: rm.id })))] } };
  let plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), "2 adults, Indian, 16 Jan 2027, Nagpur in and out, Pench 3 nights", c4, TODAY);
  assert.match(r.reply.text, /Which room at Pench Tree Lodge: Cottage, Treehouse, Forest Suite or Deluxe Room/);
  assert.deepEqual(r.reply.quick!.map((q) => q.label), ["Cottage", "Treehouse", "Forest Suite", "Deluxe Room"]);
  r = chatTurn(r.plan, r.flags, "deluxe room", c4, TODAY);
  assert.equal(r.plan.stops[0].room_category_id, "PTL_D");
  plan = emptyPlan(TODAY);
  r = chatTurn(plan, initialFlags(plan), "2 adults, 16 Jan 2027, Nagpur in and out, Pench 3 nights in the forest suite", c4, TODAY);
  assert.equal(r.plan.stops[0].room_category_id, "PTL_S");
});

test("asks the hotel for city nights; 'same' copies the other stay", () => {
  let plan = emptyPlan(TODAY);
  let flags = initialFlags(plan);
  const say = (m: string) => {
    const r = chatTurn(plan, flags, m, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
  let r = say("2 adults, Indian, land in delhi, stay one night at delhi then fly to nagpur on 16 Jan 2027, Tadoba 4 nights then Pench 3 nights, then leave from nagpur to delhi, stay in delhi one night");
  assert.equal(plan.arrival_location_id, "NAG");
  assert.equal(plan.departure_location_id, "NAG");
  assert.match(r.reply.text, /Which hotel in Delhi \(1 night before the safari\)/);
  r = say("The Imperial, 18k");
  assert.match(r.reply.text, /Which hotel in Delhi \(1 night at the end\)/);
  assert.ok(r.reply.quick!.some((q) => q.label === "Same: The Imperial"));
  r = say("same");
  assert.deepEqual(plan.city_stays!.map((c) => [c.hotel, c.price]), [["The Imperial", 18000], ["The Imperial", 18000]].slice(0, plan.city_stays!.length));
});

test("asks which lodge where a park has two of ours; a named lodge needs no question", () => {
  const two = { ...ctx, properties: [...ctx.properties, { id: "PT2", name: "Pench Jungle Camp", park_id: "PENCH", kind: "own_lodge", fallback_priority: 2, sort: 1 }], rooms: [...ctx.rooms, { id: "PT2_AC", property_id: "PT2", name: "AC Cottage", sort: 0 }], locations: [...ctx.locations, { id: "L_PT2", name: "Pench Jungle Camp", type: "property", property_id: "PT2" }] };
  const plan = emptyPlan(TODAY);
  let r = chatTurn(plan, initialFlags(plan), "2 adults, Indian, 16 Jan 2027, Nagpur in and out, Pench 3 nights", two, TODAY);
  assert.match(r.reply.text, /Which lodge in Pench[^:]*: Pench Tree Lodge or Pench Jungle Camp\?/);
  r = chatTurn(r.plan, r.flags, "Pench Jungle Camp", two, TODAY);
  assert.equal(r.plan.stops[0].property_id, "PT2");
  assert.doesNotMatch(r.reply.text, /Which lodge/);
  const named = chatTurn(plan, initialFlags(plan), "2 adults, Indian, 16 Jan 2027, Nagpur in and out, 3 nights at Pench Tree Lodge", two, TODAY);
  assert.doesNotMatch(named.reply.text, /Which lodge/);
});

test("the AI choosing a lodge the message did not name: the lodge question is still asked", async () => {
  const { aiToParsed } = await import("./ai");
  const two = { ...ctx, properties: [...ctx.properties, { id: "PT2", name: "Pench Jungle Camp", park_id: "PENCH", kind: "own_lodge", fallback_priority: 2, sort: 1 }], rooms: [...ctx.rooms, { id: "PT2_AC", property_id: "PT2", name: "AC Cottage", sort: 0 }], locations: [...ctx.locations, { id: "L_PT2", name: "Pench Jungle Camp", type: "property", property_id: "PT2" }] };
  const plan = emptyPlan(TODAY);
  const msg = "2 adults, Indian, 16 Jan 2027, Nagpur in and out, Pench 3 nights";
  // Gemini answers with a lodge on its own
  const ai = aiToParsed({ adults: 2, nationality: "indian", arrival_date: "2027-01-16", arrival_place: "Nagpur Airport", departure_place: "Nagpur Airport", stops: [{ park: "Pench", lodge: "Pench Jungle Camp", nights: 3 }] }, two);
  assert.equal(ai.parks[0].lodge, "Pench Jungle Camp");
  const r = chatTurn(plan, initialFlags(plan), msg, two, TODAY, ai, { aiPrimary: true });
  assert.match(r.reply.text, /Which lodge in Pench/);
  assert.ok(!(r.flags.lodgeDecided ?? []).includes("PENCH"));
  // when the message does name it, the AI's lodge is used and nothing is asked
  const named = chatTurn(plan, initialFlags(plan), msg.replace("Pench 3 nights", "3 nights at Pench Jungle Camp"), two, TODAY, ai, { aiPrimary: true });
  assert.equal(named.plan.stops[0].property_id, "PT2");
  assert.doesNotMatch(named.reply.text, /Which lodge/);
});
