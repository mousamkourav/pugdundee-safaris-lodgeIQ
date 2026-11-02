// Run with:  npx tsx --test lib/sales/plan/confirm.test.ts
// Quotes safe even when the reader misreads: the trip confirmed in plain words (with
// one-click corrections), hard checks before saving, and a trip built with a form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { chatTurn, initialFlags } from "./chat";
import { buildDays, emptyPlan, planToTrip } from "./planner";
import { confirmKey, editStay, editStop, isConfirmed, markConfirmed, removeFlight, stopChoices, tripSummary } from "./confirm";
import { quoteChecks } from "./checks";
import { formAddCityNight, formAddFlight, formAddStop, formExperiences, formStopProblems } from "./form";
import { roseateCtx as ctx } from "./reader-fixture";
import type { Plan } from "./types";

const TODAY = "2026-10-31";
const GERMANY =
  "2 adults from Germany, arriving Delhi 20 April 2027, 1 night Roseate House, next morning flight to Jabalpur, then Tree House Hideaway 3 nights with 4 safaris all with naturalist, then Kanha 2 nights bush dinner on last night, then Pench 2 nights, then drive to Nagpur and fly to Delhi, 1 night Roseate again, next day flight to Jorhat, Kaziranga Iora Retreat 2 nights with 2 jeep safaris and 1 camera, then fly Jorhat to Delhi and go home";

const read = (text: string) => {
  const p = emptyPlan(TODAY);
  return chatTurn(p, initialFlags(p), text, ctx, TODAY).plan;
};
const rebuilt = (p: Plan): Plan => ({ ...p, days: buildDays(p, ctx) });
const priced = (p: Plan) => priceTrip(planToTrip(p, TODAY), ctx.pricing);
// every price Master data does not have, typed (Rs 5,000 each)
const typed = (p: Plan): Plan => ({ ...p, manual_prices: Object.fromEntries(priced(p).missing.map((m) => [m.key, 5000])) });
const roads = (p: Plan) => planToTrip(p, TODAY).transfers.map((t) => `${t.date.slice(5)} ${t.from_location_id}>${t.to_location_id}`);

// ---------------- the trip in plain words ----------------

test("Confirm: the German enquiry in plain words, in the order it happens", () => {
  const lines = tripSummary(read(GERMANY), ctx);
  assert.equal(lines[0].text, "2 adults, 1 room, foreign guests");
  assert.equal(lines[0].detail, "11 nights, Tue, 20 Apr 2027 to Sat, 1 May 2027");
  assert.deepEqual(
    lines.slice(1).map((l) => l.text),
    [
      "Tue, 20 Apr 2027 - Transfer Delhi Airport to Roseate House",
      "Tue, 20 Apr 2027 - Delhi: 1 night at Roseate House",
      "Wed, 21 Apr 2027 - Transfer Roseate House to Delhi Airport",
      "Wed, 21 Apr 2027 - Flight Delhi to Jabalpur",
      "Wed, 21 Apr 2027 - Transfer Jabalpur Airport to Tree House Hideaway",
      "Wed, 21 Apr 2027 - Tree House Hideaway (Bandhavgarh National Park): 3 nights",
      "Sat, 24 Apr 2027 - Transfer Tree House Hideaway to Kanha Earth Lodge",
      "Sat, 24 Apr 2027 - Kanha Earth Lodge (Kanha National Park): 2 nights",
      "Mon, 26 Apr 2027 - Transfer Kanha Earth Lodge to Pench Tree Lodge",
      "Mon, 26 Apr 2027 - Pench Tree Lodge (Pench National Park): 2 nights",
      "Wed, 28 Apr 2027 - Transfer Pench Tree Lodge to Nagpur Airport",
      "Wed, 28 Apr 2027 - Flight Nagpur to Delhi",
      "Wed, 28 Apr 2027 - Transfer Delhi Airport to Roseate House",
      "Wed, 28 Apr 2027 - Delhi: 1 night at Roseate House",
      "Thu, 29 Apr 2027 - Transfer Roseate House to Delhi Airport",
      "Thu, 29 Apr 2027 - Flight Delhi to Jorhat",
      "Thu, 29 Apr 2027 - Transfer Jorhat Airport to Iora Retreat",
      "Thu, 29 Apr 2027 - Iora Retreat (Kaziranga National Park): 2 nights",
      "Sat, 1 May 2027 - Transfer Iora Retreat to Jorhat Airport",
      "Sat, 1 May 2027 - Flight Jorhat to Delhi",
    ]
  );
  const stop = (i: number) => lines.find((l) => l.stop === i)!;
  assert.equal(stop(0).detail, "Tree House, full board; 4 safaris (all with a naturalist)");
  assert.match(stop(1).detail!, /^Cottage, full board; 2 safaris; Bush dinner$/);
  assert.match(stop(3).detail!, /Camera fee/);
  // each lodge, city night and flight line is editable
  assert.deepEqual(lines.filter((l) => l.stop !== undefined).map((l) => l.stop), [0, 1, 2, 3]);
  assert.deepEqual(lines.filter((l) => l.stay !== undefined).map((l) => l.stay), [0, 1]);
  assert.deepEqual(lines.filter((l) => l.flight !== undefined).map((l) => l.flight), [0, 1, 2, 3]);
});

test("Confirm: one-click corrections (nights, lodge, room, remove, move) keep city nights in their place", () => {
  const p = read(GERMANY);
  // nights
  assert.equal(editStop(p, ctx, 1, { nights: 3 }).stops[1].nights, 3);
  // lodge: Tree House Hideaway -> Kings Lodge (same park), its first room
  const kl = editStop(p, ctx, 0, { property_id: "KL" }).stops[0];
  assert.deepEqual([kl.property_id, kl.room_category_id], ["KL", "KL_C"]);
  assert.deepEqual(stopChoices(p, ctx, 0).lodges.map((l) => l.id).sort(), ["KL", "THH"]);
  // room
  const ptl = editStop(p, ctx, 2, { room_category_id: "PTL_T" }).stops[2];
  assert.equal(ptl.room_category_id, "PTL_T");
  // remove Kanha: the Delhi night that was after 3 lodges is now after 2 (still before Iora)
  const noKanha = editStop(p, ctx, 1, "remove");
  assert.deepEqual(noKanha.stops.map((s) => s.property_id), ["THH", "PTL", "IORA"]);
  assert.equal(noKanha.city_stays?.[1].at, 2);
  // move Pench before Kanha; the Delhi night stays between the 3rd and 4th lodge
  const moved = editStop(p, ctx, 2, "up");
  assert.deepEqual(moved.stops.map((s) => s.property_id), ["THH", "PTL", "KEL", "IORA"]);
  assert.equal(moved.city_stays?.[1].at, 3);
  assert.equal(editStop(p, ctx, 0, "up"), p); // nothing above the first
  // city nights and flights
  assert.equal(editStay(p, 1, { nights: 2 }).city_stays?.[1].nights, 2);
  assert.equal(editStay(p, 0, "remove").city_stays?.length, 1);
  assert.equal(removeFlight(p, 3).flights?.length, 3);
});

test("Confirm: the confirmation holds only for the route that was checked", () => {
  const p = read(GERMANY);
  assert.equal(isConfirmed(p), false);
  const ok = markConfirmed(p, "2026-11-01T10:00:00Z");
  assert.equal(isConfirmed(ok), true);
  assert.match(ok.confirmed!.key, /^r2-[0-9a-f]{8}-\d+$/);
  // the same route: still confirmed; a correction to it: confirm again
  assert.equal(isConfirmed({ ...ok, guest: { ...ok.guest, name: "Mr Weber" } }), true);
  assert.equal(isConfirmed(editStop(ok, ctx, 1, { nights: 3 })), false);
  assert.notEqual(confirmKey(editStop(ok, ctx, 1, { nights: 3 })), ok.confirmed!.key);
});

// ---------------- hard checks before saving ----------------

test("Checks: the German enquiry, confirmed with every price typed, can be saved", () => {
  const p = typed(markConfirmed(read(GERMANY), "x"));
  assert.deepEqual(quoteChecks(p, ctx, priced(p)), []);
});

test("Checks: not confirmed, prices still needed: saving is blocked, each with what to do", () => {
  const p = read(GERMANY);
  const problems = quoteChecks(p, ctx, priced(p));
  assert.ok(problems.some((x) => /^Confirm the trip first/.test(x)));
  assert.ok(problems.some((x) => /^Price needed: Transfer Jabalpur Airport to Tree House Hideaway/.test(x)));
  // confirmed, then changed: asked to check again
  const changed = editStop(markConfirmed(p, "x"), ctx, 1, { nights: 3 });
  assert.ok(quoteChecks(changed, ctx, null).some((x) => /^The route changed after it was confirmed/.test(x)));
});

test("Checks: a stop without a room, the days not continuous, a road between regions, no way in or out", () => {
  const base = typed(markConfirmed(read(GERMANY), "x"));
  // a stop without a room
  const noRoom = { ...base, stops: base.stops.map((s, i) => (i === 1 ? { ...s, room_category_id: "" } : s)) };
  assert.ok(quoteChecks(noRoom, ctx, null).some((x) => /choose a room/.test(x)));
  // a day missing in the middle
  const gap = { ...base, days: base.days.filter((d) => d.date !== "2027-04-25") };
  assert.ok(quoteChecks(gap, ctx, priced(gap)).some((x) => /No day in the plan for Sun, 25 Apr 2027/.test(x)));
  // a drive from Pench to Iora Retreat (two regions) put in by hand
  const far = { ...base, days: base.days.map((d) => (d.date === "2027-04-29" ? { ...d, transfer: { from_location_id: "L_PTL", to_location_id: "L_IORA" } } : d)) };
  assert.ok(quoteChecks(far, ctx, priced(typed(far))).some((x) => /road transfer Pench Tree Lodge to Iora Retreat joins two regions/.test(x)));
  // no arrival point and no flight before the first lodge: no way in
  const noWayIn = rebuilt(typed(markConfirmed({ ...read("2 adults, Kanha 2 nights, 16 Jan 2027"), arrival_location_id: null, departure_location_id: "JLR" }, "x")));
  const withPrices = typed(markConfirmed(noWayIn, "x"));
  assert.ok(quoteChecks(withPrices, ctx, priced(withPrices)).some((x) => /Kanha Earth Lodge: no way in/.test(x)));
  // their own vehicle is a way in
  const own = typed(markConfirmed(rebuilt({ ...noWayIn, arrival_mode: "own" }), "x"));
  assert.ok(!quoteChecks(own, ctx, priced(own)).some((x) => /no way in/.test(x)));
});

// ---------------- build with a form ----------------

test("Form: the German trip built entry by entry gives the same route as the chat", () => {
  let p: Plan = { ...emptyPlan(TODAY), arrival_date: "2027-04-21" };
  p = { ...p, guest: { ...p.guest, adults: 2, rooms: 1, country: "DE", nationality: "foreign" } };
  p = formAddCityNight(p, { city: "Delhi", hotel: "Roseate House", nights: 1, after: 0 });
  p = formAddFlight(p, { from: "Delhi", to: "Jabalpur" });
  p = formAddStop(p, ctx, { park_id: "BAN", property_id: "THH", room_category_id: "THH_T", nights: 3, safaris: 4, naturalists: -1 });
  p = formAddStop(p, ctx, { park_id: "KAN", property_id: "KEL", room_category_id: "KEL_C", nights: 2, addon_ids: ["BUSH"] });
  p = formAddStop(p, ctx, { park_id: "PEN", property_id: "PTL", room_category_id: "PTL_C", nights: 2 });
  p = formAddFlight(p, { from: "Nagpur", to: "Delhi" });
  p = formAddCityNight(p, { city: "Delhi", hotel: "Roseate House", nights: 1, after: 3 });
  p = formAddFlight(p, { from: "Delhi", to: "Jorhat" });
  p = formAddStop(p, ctx, { park_id: "KAZ", property_id: "IORA", room_category_id: "IORA_D", nights: 2, safaris: 2, addon_ids: ["CAM"] });
  p = formAddFlight(p, { from: "Jorhat", to: "Delhi" });
  p = rebuilt({ ...p, departure_location_id: "JRH" });
  const chat = read(GERMANY);
  assert.deepEqual(roads(p), roads(chat));
  assert.deepEqual(
    tripSummary(p, ctx).slice(1).map((l) => l.text),
    tripSummary(chat, ctx).slice(1).map((l) => l.text)
  );
  const ok = typed(markConfirmed(p, "x"));
  assert.deepEqual(quoteChecks(ok, ctx, priced(ok)), []);
});

test("Form: entries that do not fit are refused, with the reason", () => {
  assert.deepEqual(formStopProblems(ctx, { park_id: "BAN", property_id: "KEL", room_category_id: "KEL_C", nights: 2 }), ["Choose a lodge in that park."]);
  assert.deepEqual(formStopProblems(ctx, { park_id: "KAN", property_id: "KEL", room_category_id: "KEL_C", nights: 0 }), ["Nights: 1 to 30."]);
  assert.deepEqual(formStopProblems(ctx, { park_id: "KAN", property_id: "KEL", room_category_id: "KEL_C", nights: 2, safaris: 2, naturalists: 3 }), ["Safaris with a naturalist: not more than the safaris."]);
  const p = emptyPlan(TODAY);
  assert.equal(formAddStop(p, ctx, { park_id: "BAN", property_id: "KEL", room_category_id: "KEL_C", nights: 2 }), p);
  assert.equal(formAddFlight(p, { from: "Delhi", to: "delhi" }), p);
  assert.equal(formAddCityNight(p, { city: " ", nights: 1, after: 0 }), p);
  // the experiences offered at a lodge: its own, its park's, and the general ones
  assert.ok(formExperiences(ctx, "IORA").some((a) => a.id === "CAM"));
  assert.ok(!formExperiences(ctx, "KEL").some((a) => a.id === "CAM"));
  assert.ok(formExperiences(ctx, "KEL").some((a) => a.id === "BUSH"));
});

// 2 Nov 2026: a trip read by the AI was refused on save ("The route changed after it was
// confirmed") with nothing changed: the AI builds a city stay as {when, city, nights, hotel, at},
// the server's sanitizePlan rebuilds it as {when, city, nights, at, ..., hotel}, and the key was
// the JSON as built. The key is now made from the sanitized plan in one canonical form.
test("a confirmed route stays confirmed on the server, however its objects were built", async () => {
  const { realCtx } = await import("./real-fixture");
  const { chatTurn: turn, initialFlags: flags0 } = await import("./chat");
  const { emptyPlan: empty } = await import("./planner");
  const { sanitizePlan } = await import("./sanitize");
  const msg = "Hi team, pls quote for 2 adults from UK, 1 room, dates not fixed yet. Arrive Delhi 1 night at roseate with delhi sightseeing, local guide and entrances, next day fly to jabalpur, kings lodge 3 nights with village walk and cycling, then pench 2 nights with culinary workshop and buffer walk, then fly nagpur to delhi and drive direct to agra 2 nights at itc mughal with agra sightseeing and local guide, then drive to jaipur 2 nights at itc rajputana with jaipur sightseeing and accompanying guide, drive back to delhi for homebound flight. all safaris with naturalist";
  const read = turn(empty("2026-11-02"), flags0(empty("2026-11-02")), msg, realCtx, "2026-11-02").plan;
  // the city stays as the AI path builds them: hotel before at, extras last; an empty vehicle
  const asAi = {
    ...read,
    vehicle_type: "",
    city_stays: (read.city_stays ?? []).map((c, i) => {
      const { want_extras, hotel, ...rest } = c;
      return { ...rest, ...(hotel ? { hotel } : {}), at: c.when === "after" ? 2 : undefined, ...(want_extras ? { want_extras } : {}), ...(i === 0 ? { price: undefined } : {}) };
    }),
  } as typeof read;
  const confirmed = markConfirmed(asAi, "2026-11-02T10:00:00Z");
  assert.ok(isConfirmed(confirmed));
  const onServer = sanitizePlan(JSON.parse(JSON.stringify(confirmed)))!;
  assert.ok(isConfirmed(onServer), "the server sees the same confirmed route");
  // a real change still asks again
  assert.ok(!isConfirmed({ ...onServer, stops: onServer.stops.map((s, i) => (i === 1 ? { ...s, nights: 3 } : s)) }));
});
