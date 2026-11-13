// Several room types at one lodge (13 Nov 2026, G. Manager: "1 Cottage & 1 Tree House for Pench"),
// on the owner's real Master data. Every figure below is worked out by hand from the rates:
//   Pench Tree Lodge, foreign, High season (1 Feb - 18 Mar 2027), full board, + 18% GST:
//   AC Cottage 22,000 a room (single 22,000 too, extra adult 8,800); AC Treehouse 25,500.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "./chat";
import { emptyPlan, planToTrip, roomsOf } from "./planner";
import { editStop, markConfirmed } from "./confirm";
import { realCtx } from "./real-fixture";
import { sanitizePlan } from "./sanitize";
import { addRoomType, mixProblems, roomLabel, setMixEntry, splitGuests } from "./room-mix";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { defaultGroup } from "@/lib/sales/group/costing";
import type { Plan } from "./types";

const T = "2026-11-13";
const TRIP = "foreign, arriving Jabalpur 20 feb 2027, Kanha 3 nights at Kanha Earth Lodge, Pench 3 nights at Pench Tree Lodge, drive to Nagpur";
const read = (msg: string, plan = emptyPlan(T)) => chatTurn(plan, initialFlags(plan), msg, realCtx, T).plan;
const pench = (p: Plan) => p.stops.findIndex((s) => realCtx.properties.find((x) => x.id === s.property_id)?.name === "Pench Tree Lodge");
const roomId = (name: string) => realCtx.rooms.find((r) => r.name === name && roomsOf(realCtx, realCtx.properties.find((x) => x.name === "Pench Tree Lodge")!.id).some((x) => x.id === r.id))!.id;
const price = (p: Plan) => priceTrip(planToTrip(markConfirmed(p, T), T), realCtx.pricing);
const penchRooms = (p: Plan) => price(p).lines.filter((l) => l.kind === "room" && /^Pench Tree Lodge/.test(l.description));
const COT = 22000 * 1.18; // 25,960
const TREE = 25500 * 1.18; // 30,090

test("1 AC Cottage + 1 AC Treehouse, 4 adults: each room type at its own rate, every night", () => {
  const p = read(`4 adults, 2 rooms, ${TRIP}, 1 cottage and 1 treehouse at Pench`);
  const i = pench(p);
  assert.equal(roomLabel(p.stops[i], realCtx), "1 AC Cottage + 1 AC Treehouse");
  assert.deepEqual(p.stops[i].room_mix!.map((m) => [m.rooms, m.adults]), [[1, 2], [1, 2]]);
  const res = price(p);
  assert.deepEqual(res.errors, []);
  const lines = penchRooms(p);
  assert.equal(lines.length, 6); // 3 nights x 2 room types
  for (const l of lines) assert.equal(l.amount, /Treehouse/.test(l.description) ? TREE : COT);
  assert.equal(lines.reduce((t, l) => t + l.amount, 0), 3 * (COT + TREE)); // 1,68,150
  // the per-guest prices still add up to the total
  const s = res.split!;
  assert.ok(Math.abs(s.adult * 4 - res.totals.grand) <= 4, `${s.adult} x 4 vs ${res.totals.grand}`);
});

test("3 adults: 2 in a Cottage (double), 1 in a Treehouse (single rate)", () => {
  let p = read(`3 adults, 2 rooms, ${TRIP}`);
  const i = pench(p);
  p = { ...p, stops: p.stops.map((s, k) => (k === i ? { ...s, room_category_id: roomId("AC Cottage"), room_mix: [
    { room_category_id: roomId("AC Cottage"), rooms: 1, adults: 2, children: [] },
    { room_category_id: roomId("AC Treehouse"), rooms: 1, adults: 1, children: [] },
  ] } : s)) };
  const rate = realCtx.pricing.roomRates.find((r) => r.room_category_id === roomId("AC Treehouse") && r.valid_from <= "2027-02-24" && r.valid_to >= "2027-02-24" && r.meal_plan === "AP" && (r.nationality ?? "all") !== "indian" && r.active)!;
  const single = (rate.rate_single ?? rate.rate_double) * 1.18;
  for (const l of penchRooms(p)) assert.equal(l.amount, /Treehouse/.test(l.description) ? Math.round(single) : COT);
});

test("a child in the Treehouse: the child's rate on the Treehouse only", () => {
  let p = read(`2 adults and 1 child age 8, 2 rooms, ${TRIP}`);
  const i = pench(p);
  p = { ...p, stops: p.stops.map((s, k) => (k === i ? { ...s, room_category_id: roomId("AC Cottage"), room_mix: [
    { room_category_id: roomId("AC Cottage"), rooms: 1, adults: 1, children: [] },
    { room_category_id: roomId("AC Treehouse"), rooms: 1, adults: 1, children: [8] },
  ] } : s)) };
  const res = price(p);
  assert.deepEqual(res.errors, []);
  const cot = penchRooms(p).filter((l) => /Cottage/.test(l.description));
  const tree = penchRooms(p).filter((l) => /Treehouse/.test(l.description));
  assert.ok(cot.every((l) => l.pax!.child[0] === 0), "no child share on the Cottage");
  assert.ok(tree.every((l) => l.pax!.child[0] > 0), "the child's share on the Treehouse");
  const sp = res.split!;
  const sum = sp.adult * 2 + sp.children.reduce((t, c) => t + c.amount, 0);
  assert.ok(Math.abs(sum - res.totals.grand) <= 3, `${sum} vs ${res.totals.grand}`);
});

test("the room types must hold the trip's guests: else a clear error, no price", () => {
  let p = read(`4 adults, 2 rooms, ${TRIP}, 1 cottage and 1 treehouse at Pench`);
  const i = pench(p);
  p = { ...p, stops: p.stops.map((s, k) => (k === i ? setMixEntry(s, 1, { adults: 1 }) : s)) };
  const res = price(p);
  assert.ok(res.errors.some((e) => /^Pench Tree Lodge: the room types hold 3 adults, the trip has 4\./.test(e)), JSON.stringify(res.errors));
  assert.match(mixProblems(p.stops[i], p.guest, realCtx, "Pench Tree Lodge")[0], /hold 3 adults, the trip has 4/);
  // the guests changed in the chat: spread over the same rooms again, no error
  const q = read("5 adults", p);
  assert.deepEqual(q.stops[pench(q)].room_mix!.map((m) => [m.rooms, m.adults]), [[1, 3], [1, 2]]);
  assert.deepEqual(price(q).errors.filter((e) => /room types/.test(e)), []);
});

test("offers count the lodge's nights once: 2 lodges x 3 nights is 6 nights, not 9", () => {
  const p = read(`4 adults, 2 rooms, ${TRIP}, 1 cottage and 1 treehouse at Pench`);
  const res = price(p);
  assert.ok(res.warnings.some((w) => /Any 2 Pugdundee lodges, 6 nights/.test(w)));
  const offer = realCtx.pricing.offers.find((o) => /Any 2 Pugdundee lodges/.test(o.name))!;
  const withOffer = priceTrip(planToTrip(markConfirmed({ ...p, offer_ids: [offer.id] }, T), T), realCtx.pricing);
  const pd = withOffer.lines.filter((l) => l.kind === "discount" && l.property_id === p.stops[pench(p)].property_id);
  // 10% of both room types' nights (incl. GST): 3 x (25,960 + 30,090) x 10%
  assert.equal(pd.reduce((t, l) => t + l.amount, 0), -Math.round(3 * (COT + TREE) * 0.1));
});

test("reading: in the lodge's part, before the park, in words, and as a change to a trip", () => {
  for (const m of [
    `4 adults, 2 rooms, foreign, arriving Jabalpur 20 feb 2027, Kanha 3 nights at Kanha Earth Lodge, Pench 3 nights at Pench Tree Lodge with 1 cottage and 1 treehouse, drive to Nagpur`,
    `4 adults, 2 rooms, foreign, arriving Jabalpur 20 feb 2027, Kanha 3 nights at Kanha Earth Lodge, one cottage and one tree house at Pench, Pench 3 nights at Pench Tree Lodge, drive to Nagpur`,
  ]) {
    const p = read(m);
    assert.equal(roomLabel(p.stops[pench(p)], realCtx), "1 AC Cottage + 1 AC Treehouse", m);
    assert.ok(!p.stops[0].room_mix, "Kanha keeps one room type");
  }
  const base = read(`4 adults, 2 rooms, ${TRIP}`);
  assert.ok(!base.stops[pench(base)].room_mix);
  const changed = read("1 cottage and 1 treehouse at Pench", base);
  assert.equal(roomLabel(changed.stops[pench(changed)], realCtx), "1 AC Cottage + 1 AC Treehouse");
  // and back to one room type
  const back = read("treehouse at Pench", changed);
  assert.ok(!back.stops[pench(back)].room_mix);
  assert.equal(roomLabel(back.stops[pench(back)], realCtx), "AC Treehouse");
});

test("the plan keeps the room types (and checks them); a lodge change drops them; a group quote ignores them", () => {
  const p = read(`4 adults, 2 rooms, ${TRIP}, 1 cottage and 1 treehouse at Pench`);
  const i = pench(p);
  const clean = sanitizePlan(JSON.parse(JSON.stringify(p)))!;
  assert.deepEqual(clean.stops[i].room_mix, p.stops[i].room_mix);
  // rubbish from the browser: whole numbers in range, a one-entry mix is no mix
  const bad = sanitizePlan(JSON.parse(JSON.stringify({ ...p, stops: p.stops.map((s, k) => (k === i ? { ...s, room_mix: [{ room_category_id: "x", rooms: -3, adults: "lots", children: [99, 4] }] } : s)) })))!;
  assert.equal(bad.stops[i].room_mix, undefined);
  const odd = sanitizePlan(JSON.parse(JSON.stringify({ ...p, stops: p.stops.map((s, k) => (k === i ? { ...s, room_mix: [{ room_category_id: "a", rooms: 99, adults: 2, children: [99, 4] }, { room_category_id: "b", rooms: 1, adults: 1, children: [] }] } : s)) })))!;
  assert.deepEqual(odd.stops[i].room_mix![0], { room_category_id: "a", rooms: 20, adults: 2, children: [4] });
  assert.equal(odd.stops[i].room_category_id, "a");
  // another lodge: one room type again; another first room: the first entry follows
  const other = roomsOf(realCtx, p.stops[i].property_id).find((r) => r.name !== "AC Cottage" && r.name !== "AC Treehouse");
  if (other) {
    const r = editStop(p, realCtx, i, { room_category_id: other.id });
    assert.equal(r.stops[i].room_mix![0].room_category_id, other.id);
  }
  const lodges = realCtx.properties.filter((x) => x.park_id === p.stops[i].park_id && x.id !== p.stops[i].property_id);
  if (lodges.length) assert.equal(editStop(p, realCtx, i, { property_id: lodges[0].id }).stops[i].room_mix, undefined);
  // a group quote is costed per room on its own sheet: one room type per lodge there
  const g = planToTrip(markConfirmed({ ...p, group: defaultGroup() }, T), T);
  assert.equal(g.stays.filter((s) => s.adults != null).length, 0);
});

test("adding and removing a room type on the Confirm step", () => {
  const p = read(`4 adults, 2 rooms, ${TRIP}`);
  const i = pench(p);
  const added = addRoomType(p.stops[i], p.guest, roomId("AC Treehouse"));
  assert.deepEqual(added.room_mix!.map((m) => [realCtx.rooms.find((r) => r.id === m.room_category_id)!.name, m.rooms, m.adults]), [[realCtx.rooms.find((r) => r.id === p.stops[i].room_category_id)!.name, 1, 2], ["AC Treehouse", 1, 2]]);
  const removed = setMixEntry(added, 1, "remove");
  assert.equal(removed.room_mix, undefined);
  assert.equal(removed.room_category_id, p.stops[i].room_category_id);
  // 5 adults over 2 + 1 rooms: 2, 2 | 1; the children with the first room type
  assert.deepEqual(splitGuests([{ room_category_id: "a", rooms: 2 }, { room_category_id: "b", rooms: 1 }], { adults: 5, children: [7] }).map((m) => [m.adults, m.children]), [[4, [7]], [1, []]]);
});
