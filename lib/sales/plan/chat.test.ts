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
  assert.match(r.reply.text, /Before I can quote/);
  assert.ok(r.reply.warnings!.some((w) => w.includes("No transfer rate") && w.includes("on their own")));
  r = chatTurn(r.plan, r.flags, "on their own", noTransfers, TODAY);
  assert.equal(r.plan.arrival_location_id, null);
  assert.match(r.reply.text, /Total/);
  plan = emptyPlan(TODAY);
  r = chatTurn(plan, initialFlags(plan), "hello there", ctx, TODAY);
  assert.match(r.reply.text, /did not catch/);
});
