// The JJ quote (10 Nov 2026): "naturalist on every safari" written at the end of the enquiry gave a
// naturalist only in the last park (at the start, in none), so the other parks' naturalists were
// not charged. Now every park's safaris have one, the full-day safari its full-day naturalist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "./chat";
import { emptyPlan, planToTrip } from "./planner";
import { markConfirmed } from "./confirm";
import { realCtx } from "./real-fixture";
import { priceTrip } from "@/lib/sales/pricing/engine";

const T = "2026-11-10";
const TRIP = "arriving Jabalpur 18 feb 2027, Bandhavgarh 4 nights at Kings Lodge with a full-day safari, Kanha 3 nights at Kanha Earth Lodge, Pench 3 nights at Pench Tree Lodge, drive to Nagpur";
const read = (msg: string) => chatTurn(emptyPlan(T), initialFlags(emptyPlan(T)), msg, realCtx, T).plan;
const safaris = (p: ReturnType<typeof read>) => p.days.flatMap((d) => d.safaris);

for (const msg of [
  `2 adults, ${TRIP}, naturalist on every safari`,
  `2 adults, naturalist on every safari, ${TRIP}`,
  `2 adults, ${TRIP}. Naturalists for all the safaris please`,
  `2 adults, ${TRIP}, all safaris with naturalist`,
  `2 adults, ${TRIP}, har safari mein naturalist chahiye`,
]) {
  test(`every park gets the naturalists: "${msg.slice(-45)}"`, () => {
    const p = read(msg);
    assert.equal(p.stops.length, 3);
    assert.ok(p.stops.every((s) => s.want_naturalists === -1), JSON.stringify(p.stops.map((s) => s.want_naturalists)));
    const all = safaris(p);
    assert.ok(all.length >= 10);
    assert.ok(all.every((s) => s.naturalist), "every safari has a naturalist");
    // charged: one naturalist line per safari (the full day: the full-day naturalist, Rs 7,500 + 5%)
    const res = priceTrip(planToTrip(markConfirmed(p, T), T), realCtx.pricing);
    const nat = res.lines.filter((l) => l.kind === "safari" && l.group === "naturalist");
    assert.equal(nat.length, all.length);
    const full = nat.find((l) => /full-day/i.test(l.description));
    assert.ok(full, "full-day naturalist charged");
    assert.equal(full!.amount, 7875);
  });
}

test("a naturalist for one park stays that park's own", () => {
  const p = read("2 adults, arriving Jabalpur 18 feb 2027, Bandhavgarh 3 nights at Kings Lodge, Kanha 3 nights at Kanha Earth Lodge with naturalist, drive to Nagpur");
  assert.deepEqual(p.stops.map((s) => s.want_naturalists ?? null), [null, -1]);
});

test("no naturalist asked: none charged", () => {
  const p = read(`2 adults, ${TRIP}`);
  assert.ok(safaris(p).every((s) => !s.naturalist));
});

test("without naturalists: none", () => {
  const p = read(`2 adults, ${TRIP}, every safari without naturalist`);
  assert.ok(safaris(p).every((s) => !s.naturalist));
});

// JJ (PS-2026-0063): "change room category to treehouse in pench" and "treehouse category at
// pench" were typed in the chat, but Pench stayed AC Cottage (the room word was read only after the
// park's name): 3 nights x Rs 3,500 short. Now the park named right after the room type takes it.
const JJ_START = "Pickup from Jabalpur, Kings lodge 4 nights with 06 safaris, drive to kanha 4 nights with 6 safaris, drive to pench 4 nights with 6 safaris and drop to nagpur airport";
const roomAt = (p: ReturnType<typeof read>, park: RegExp) => realCtx.rooms.find((r) => r.id === p.stops.find((s) => park.test(realCtx.pricing.parks.find((x) => x.id === s.park_id)?.name ?? ""))?.room_category_id)?.name;
for (const msg of [
  "change room category to treehouse in pench",
  "Travel in Feb 2027, 02 adults, foreign national, treehouse category at pench",
  "stay in treehouse at Pench",
  "treehouse for pench",
]) {
  test(`the room type before the park is that park's: "${msg}"`, () => {
    let p = emptyPlan(T);
    let f = initialFlags(p);
    const r1 = chatTurn(p, f, JJ_START, realCtx, T);
    p = r1.plan;
    f = r1.flags;
    assert.equal(roomAt(p, /Pench/), "AC Cottage");
    const r2 = chatTurn(p, f, msg, realCtx, T);
    assert.equal(roomAt(r2.plan, /Pench/), "AC Treehouse");
    // the other parks keep their rooms
    assert.equal(roomAt(r2.plan, /Bandhavgarh/), roomAt(p, /Bandhavgarh/));
    assert.equal(roomAt(r2.plan, /Kanha/), roomAt(p, /Kanha/));
    // and it is priced as the treehouse
    const res = priceTrip(planToTrip(markConfirmed(r2.plan, T), T), realCtx.pricing);
    assert.ok(res.lines.some((l) => l.kind === "room" && /Pench Tree Lodge, AC Treehouse/.test(l.description)));
    assert.ok(!res.lines.some((l) => l.kind === "room" && /Pench Tree Lodge, AC Cottage/.test(l.description)));
  });
}

test("a room type before one park is not taken by the park written before it", () => {
  const p = read("2 adults, arriving Jabalpur 18 feb 2027, Kanha 3 nights at Kanha Earth Lodge, treehouse at Pench, Pench 3 nights at Pench Tree Lodge, drive to Nagpur");
  assert.equal(roomAt(p, /Pench/), "AC Treehouse");
  assert.notEqual(roomAt(p, /Kanha/), "AC Treehouse");
  // "Tree House Hideaway" is a lodge, not a room type
  const t = read("2 adults, arriving Jabalpur 18 feb 2027, Tree House Hideaway in Bandhavgarh 3 nights, drive to Jabalpur");
  assert.equal(t.stops.length, 1);
});

test('"02 adults", "03 adults": a number with a leading zero is read', async () => {
  const { statesNumber } = await import("./evidence");
  assert.ok(statesNumber("02 adults", 2));
  assert.ok(statesNumber("03 adults", 3));
  assert.ok(statesNumber("06 safaris", 6));
  assert.ok(!statesNumber("2027", 2));
  assert.ok(!statesNumber("02 adults", 20));
});
