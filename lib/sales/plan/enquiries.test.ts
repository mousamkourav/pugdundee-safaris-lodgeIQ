// The 30 enquiries the sales team is expected to type (CC_ENGINE_TRAINING.md), read by the
// built-in reader alone (no Gemini): what goes into the plan, what the trip checklist
// shows, and what the assistant asks. Any misread reported later becomes a test here.
// Run with:  npx tsx --test lib/sales/plan/enquiries.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags, type ChatResult } from "./chat";
import { emptyPlan, planToTrip } from "./planner";
import { scrubForAI } from "./parse-text";
import { DELHI_KAZIRANGA, jorhatCtx, readerCtx as ctx, READER_TODAY as TODAY } from "./reader-fixture";
import type { Plan } from "./types";

function conversation(c: typeof ctx = ctx) {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  return (msg: string) => {
    const r = chatTurn(plan, flags, msg, c, TODAY);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
}
const check = (r: ChatResult, key: string) => {
  const c = r.reply.checklist?.find((x) => x.key === key);
  assert.ok(c, `no checklist line "${key}"`);
  return c;
};
const route = (p: Plan) => p.stops.map((s) => `${s.park_id} ${s.nights}${s.property_id ? ` ${s.property_id}` : ""}`);
const roads = (p: Plan) => planToTrip(p, TODAY).transfers.map((t) => `${t.from_location_id}>${t.to_location_id}`);

test("1. 2 pax indian, 16 jan 27 nagpur in out, tadoba 3n pench 2n, all safaris", () => {
  const r = conversation()("2 pax indian, 16 jan 27 nagpur in out, tadoba 3n pench 2n, all safaris");
  assert.equal(r.plan.guest.adults, 2);
  assert.equal(r.plan.guest.country, "IN");
  assert.equal(r.plan.arrival_date, "2027-01-16");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["NAG", "NAG"]);
  assert.deepEqual(route(r.plan), ["TAD 3 WEL", "PEN 2 PTL"]);
  // safaris on every full day
  const tadoba = r.plan.days.filter((d) => d.park_id === "TAD" && d.kind === "safari");
  assert.ok(tadoba.length === 2 && tadoba.every((d) => d.safaris.length === 2));
  assert.ok(check(r, "guests").ok && check(r, "nationality").ok && check(r, "date").ok && check(r, "arrival").ok && check(r, "departure").ok);
  // the one thing left: which room at Pench Tree Lodge
  assert.match(r.reply.text, /Cottage or Tree House at Pench Tree Lodge/);
  assert.equal(check(r, "stop:1").ok, false);
});

test("2. Hinglish: 2 log aa rahe hai 16 jan ko nagpur, pehle tadoba 4 raat phir pench 3 raat, ...", () => {
  const r = conversation()("2 log aa rahe hai 16 jan ko nagpur, pehle tadoba 4 raat phir pench 3 raat, sab safari naturalist ke saath, wapas nagpur se");
  assert.equal(r.plan.guest.adults, 2);
  assert.equal(r.plan.arrival_date, "2027-01-16");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["NAG", "NAG"]);
  assert.deepEqual(route(r.plan), ["TAD 4 WEL", "PEN 3 PTL"]);
  assert.ok(r.plan.stops.every((s) => s.want_naturalists === -1));
  assert.ok(r.plan.days.flatMap((d) => d.safaris).every((s) => s.naturalist));
  // nationality was not said: on the checklist as a question, never guessed
  assert.equal(check(r, "nationality").ok, false);
});

test("3. family by own car to Kanha, then Bandhavgarh, return by own car: asks the leg and the lodge", () => {
  const say = conversation();
  let r = say("Family of 4 - 2 adults 2 kids (8 and 12) from Mumbai, coming by own car to Kanha on 22 Dec, 3 nights, then Bandhavgarh 2 nights, return by own car");
  assert.equal(r.plan.guest.adults, 2);
  assert.deepEqual(r.plan.guest.children, [8, 12]);
  assert.equal(r.plan.guest.country, "IN");
  assert.equal(r.plan.arrival_date, "2026-12-22");
  assert.deepEqual([r.plan.arrival_mode, r.plan.departure_mode], ["own", "own"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], [null, null]);
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights]), [["KAN", 3], ["BAN", 2]]);
  assert.equal(r.plan.between_lodges, undefined); // not assumed
  assert.match(r.reply.text, /Between the lodges \(Kanha to Bandhavgarh\): our car, or their own vehicle\?/);
  assert.equal(check(r, "between").ok, false);
  assert.match(check(r, "stop:1").text, /Kings Lodge or Tree House Hideaway/);
  r = say("our car");
  assert.equal(r.plan.between_lodges, "ours");
  assert.match(r.reply.text, /Which lodge in Bandhavgarh/);
  r = say("Kings Lodge");
  assert.equal(r.plan.stops[1].property_id, "KL");
  // no airport transfer either way; the drive Kanha -> Kings Lodge in our car is charged
  assert.deepEqual(roads(r.plan), ["L_KEL>L_KL"]);
  assert.match(r.plan.days[0].text, /own vehicle/);
});

test("4. apni gaadi se aayenge pench, 2 raat, 4 safari chahiye, 2 adults", () => {
  const r = conversation()("apni gaadi se aayenge pench, 2 raat, 4 safari chahiye, 2 adults");
  assert.equal(r.plan.own_vehicle, true);
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights, s.want_safaris]), [["PEN", 2, 4]]);
  assert.equal(r.plan.guest.adults, 2);
  // asks the date; nationality is on the checklist as a question
  assert.match(r.reply.text, /When do they arrive/);
  assert.equal(check(r, "date").ok, false);
  assert.equal(check(r, "nationality").ok, false);
  assert.match(check(r, "arrival").text, /own vehicle/);
});

test("5. honeymoon couple from UK: Delhi night before, flights, Delhi night after", () => {
  const r = conversation()(
    "Couple from UK, honeymoon, Delhi arrival 10 Feb, fly to Jabalpur next day, Kanha 3N Bandhavgarh 3N, out from Jabalpur flight to Delhi, 1 night Delhi before departure"
  );
  assert.equal(r.plan.guest.adults, 2);
  assert.equal(r.plan.guest.country, "GB");
  assert.deepEqual(r.plan.requests, ["honeymoon"]);
  assert.deepEqual(r.plan.city_stays?.map((c) => [c.when, c.city, c.nights]), [["before", "Delhi", 1], ["after", "Delhi", 1]]);
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jabalpur", "Jabalpur>Delhi"]);
  assert.equal(r.plan.arrival_date, "2027-02-11"); // the day they reach Kanha
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JLR"]);
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights]), [["KAN", 3], ["BAN", 3]]);
  assert.match(r.reply.text, /Which lodge in Bandhavgarh/);
  assert.equal(check(r, "requests").text, "honeymoon");
});

test("6. 3 adults US by train at Katni, THH 3, Ken River 2, Khajuraho airport drop", () => {
  const r = conversation()("3 adults US, arrive by train at Katni on 5 Mar, Bandhavgarh THH 3 nights, then Panna Ken River 2 nights, Khajuraho airport drop");
  assert.equal(r.plan.guest.adults, 3);
  assert.equal(r.plan.guest.nationality, "foreign");
  assert.equal(r.plan.arrival_date, "2027-03-05");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.arrival_mode], ["KTE", "train"]);
  assert.equal(r.plan.departure_location_id, "HJR");
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "PAN 2 KRL"]);
  assert.equal(roads(r.plan)[0], "KTE>L_THH"); // the transfer from the station
  assert.match(check(r, "arrival").text, /Katni Railway Station \(train\)/);
});

test("7. Satpura 2n with boat safari and canoe, Bhopal pickup, 2 adults foreign, 12 Nov", () => {
  const r = conversation()("Satpura 2n with boat safari and canoe, Bhopal pickup, 2 adults foreign, 12 Nov");
  assert.deepEqual(route(r.plan), ["SAT 2 DBE"]);
  assert.deepEqual(r.plan.stops[0].want_extras, ["boat safari", "canoe"]);
  assert.equal(r.plan.guest.nationality, "foreign");
  assert.equal(r.plan.arrival_location_id, "BHO");
  assert.equal(r.plan.arrival_date, "2026-11-12");
  const items = r.plan.days.flatMap((d) => d.items.map((i) => i.title));
  assert.ok(items.includes("Boat safari (Foreign nationals)") && items.includes("Canoe ride"));
  // where they leave from is asked, not assumed
  assert.equal(r.plan.departure_location_id, null);
  assert.match(r.reply.text, /Where do they leave from/);
});

test("8. pench tree house 2 nights + kanha 2 nights, 4 adults 2 rooms, morning safari only, 1 safari with naturalist each place", () => {
  const r = conversation()("pench tree house 2 nights + kanha 2 nights, 4 adults 2 rooms, morning safari only, 1 safari with naturalist each place");
  assert.deepEqual(route(r.plan), ["PEN 2 PTL", "KAN 2 KEL"]);
  assert.equal(r.plan.stops[0].room_category_id, "PTL_T");
  assert.deepEqual([r.plan.guest.adults, r.plan.guest.rooms], [4, 2]);
  assert.ok(r.plan.stops.every((s) => s.want_sessions === "morning" && s.want_naturalists === 1));
  const safaris = r.plan.days.flatMap((d) => d.safaris);
  assert.ok(safaris.length && safaris.every((s) => s.session === "morning"));
  for (const park of ["PEN", "KAN"]) assert.equal(r.plan.days.filter((d) => d.park_id === park).flatMap((d) => d.safaris).filter((s) => s.naturalist).length, 1);
});

test("9. Tadoba core full day safari for photographers, 2 nights waghoba, nagpur airport, 18 Apr", () => {
  const r = conversation()("Tadoba core full day safari for photographers, 2 nights waghoba, nagpur airport, 18 Apr");
  assert.deepEqual(route(r.plan), ["TAD 2 WEL"]);
  assert.deepEqual(r.plan.stops[0].want_extras, ["full-day safari"]);
  assert.ok(r.plan.days.some((d) => d.safaris.some((s) => s.session === "full_day")));
  assert.deepEqual(r.plan.requests, ["photographers"]);
  assert.equal(r.plan.arrival_location_id, "NAG");
  assert.equal(r.plan.arrival_date, "2027-04-18");
  assert.equal(r.plan.departure_location_id, null); // asked later, not assumed
  assert.equal(check(r, "departure").ok, false);
  assert.match(r.reply.text, /How many guests/);
});

test("10. Kings 1N + THH 1N bandhavgarh, jabalpur in out, 2 pax, 1 safari each", () => {
  const r = conversation()("Kings 1N + THH 1N bandhavgarh, jabalpur in out, 2 pax, 1 safari each");
  assert.deepEqual(route(r.plan), ["BAN 1 KL", "BAN 1 THH"]);
  assert.ok(r.plan.stops.every((s) => s.want_safaris === 1));
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JLR"]);
  // one each: Kings the morning before moving on, Tree House the morning before leaving
  const sessions = r.plan.days.map((d) => d.safaris.map((s) => s.session).join("+"));
  assert.deepEqual(sessions, ["", "morning", "morning"]);
});

test("11. Delhi - agra - jaipur 4 nights by car, fly jaipur to nagpur, tadoba 3n, nagpur drop, 2 adults france", () => {
  const r = conversation()("Delhi - agra - jaipur 4 nights by car then fly jaipur to nagpur, tadoba 3n, nagpur drop. 2 adults france");
  assert.equal(r.plan.guest.country, "FR");
  assert.deepEqual(r.plan.city_stays?.map((c) => [c.city, c.nights, c.hotel]), [["Delhi - Agra - Jaipur", 4, "Outstation package (to be confirmed)"]]);
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Jaipur>Nagpur"]);
  assert.deepEqual(route(r.plan), ["TAD 3 WEL"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["NAG", "NAG"]);
  // the package is not exact: asked
  assert.match(check(r, "ask:package").text, /touring package/);
});

test("12. Kaziranga 2 nights Iora, Guwahati in out, 2 jeep safaris, camera 1", () => {
  const r = conversation()("Kaziranga 2 nights Iora, Guwahati in out, 2 jeep safaris, camera 1");
  assert.deepEqual(route(r.plan), ["KAZ 2 IORA"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["GAU", "GAU"]);
  assert.equal(r.plan.stops[0].want_safaris, 2);
  assert.deepEqual(r.plan.stops[0].want_qty, { camera: 1 });
  assert.equal(r.plan.days.flatMap((d) => d.items).find((i) => i.title === "Camera fee")?.qty, 1);
});

test("13. 2 adults + 1 infant (1 yr), indian, kanha 3n, jabalpur, 25 dec - new year", () => {
  const r = conversation()("2 adults + 1 infant (1 yr), indian, kanha 3n, jabalpur, 25 dec - new year");
  assert.deepEqual(r.plan.guest.children, [1]);
  assert.equal(r.plan.guest.country, "IN");
  assert.deepEqual(route(r.plan), ["KAN 3 KEL"]);
  assert.equal(r.plan.arrival_date, "2026-12-25");
  assert.equal(r.plan.arrival_location_id, "JLR");
  assert.match(check(r, "ask:newyear").text, /minimum stay is 3 nights and the New Year supplement/);
  assert.match(r.reply.text, /Where do they leave from/);
});

test("14. Mrs Sharma group of 8 adults, 4 rooms, pench 2n kanha 2n, bus own, 2 jeeps per safari", () => {
  const msg = "Mrs Sharma group of 8 adults, 4 rooms, pench 2n kanha 2n, bus own, need 2 jeeps per safari";
  const r = conversation()(msg);
  assert.deepEqual([r.plan.guest.adults, r.plan.guest.rooms], [8, 4]);
  assert.equal(r.plan.own_vehicle, true);
  assert.deepEqual(roads(r.plan), []);
  assert.deepEqual(route(r.plan), ["PEN 2 PTL", "KAN 2 KEL"]);
  assert.ok(r.plan.days.flatMap((d) => d.safaris).every((s) => s.jeeps === 2));
  assert.equal(r.plan.guest.name, "Mrs Sharma");
  // the name never reaches the AI
  assert.doesNotMatch(scrubForAI(msg, [r.plan.guest.name]), /sharma/i);
});

test("15. wrong, pehle kanha phir pench (after a Pench -> Kanha plan)", () => {
  const say = conversation();
  say("2 adults, pench 2n kanha 2n, 16 jan 27");
  const r = say("wrong, pehle kanha phir pench");
  assert.deepEqual(r.plan.stops.map((s) => s.park_id), ["KAN", "PEN"]);
});

test("16. pench hata do, satpura add karo 2 raat", () => {
  const say = conversation();
  say("2 adults, pench 2n kanha 2n, 16 jan 27");
  const r = say("pench hata do, satpura add karo 2 raat");
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights]), [["KAN", 2], ["SAT", 2]]);
});

test("17. make kanha 4 nights and add bush dinner on last night", () => {
  const say = conversation();
  say("2 adults, kanha 3n, jabalpur in out, 16 jan 27");
  const r = say("make kanha 4 nights and add bush dinner on last night");
  assert.equal(r.plan.stops[0].nights, 4);
  const last = r.plan.days.filter((d) => d.property_id === "KEL").pop()!;
  assert.ok(last.items.some((i) => i.title === "Bush dinner"));
});

test("18. no transfer needed, they will come on their own", () => {
  const say = conversation();
  say("2 adults, kanha 3n, jabalpur in out, 16 jan 27");
  const r = say("no transfer needed, they will come on their own");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], [null, null]);
  assert.deepEqual(roads(r.plan), []);
});

test("19. train se aayenge jabalpur, flight se jayenge nagpur se", () => {
  const say = conversation();
  say("2 adults, kanha 3n, 16 jan 27");
  const r = say("train se aayenge jabalpur, flight se jayenge nagpur se");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.arrival_mode], ["JBP_RS", "train"]);
  assert.deepEqual([r.plan.departure_location_id, r.plan.departure_mode], ["NAG", "flight"]);
});

test("20. 2 adults, 1 child 5 yrs, Indian, Satpura 2 nights in forest suite, 15 jan", () => {
  const r = conversation()("2 adults, 1 child 5 yrs, Indian, Satpura 2 nights in forest suite, 15 jan");
  assert.deepEqual(r.plan.guest.children, [5]);
  assert.equal(r.plan.guest.country, "IN");
  assert.equal(r.plan.stops[0].room_category_id, "DBE_S");
  assert.equal(r.plan.arrival_date, "2027-01-15");
});

test("21. Ken River 2 nights stilted cottage, khajuraho in out, night boat safari and fishing: asks half or full day", () => {
  const say = conversation();
  let r = say("Ken River 2 nights stilted cottage, khajuraho in out, 2 pax, night boat safari and fishing, 16 jan 27, indian");
  assert.deepEqual(route(r.plan), ["PAN 2 KRL"]);
  assert.equal(r.plan.stops[0].room_category_id, "KRL_S");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["HJR", "HJR"]);
  assert.deepEqual(r.plan.stops[0].want_extras, ["night boat safari", "fishing"]);
  assert.match(r.reply.text, /Fishing at Ken River Lodge: half day or full day\?/);
  r = say("Half-day fishing");
  assert.deepEqual(r.plan.stops[0].want_extras, ["night boat safari", "half day fishing"]);
  assert.ok(r.plan.days.flatMap((d) => d.items).some((i) => i.title === "Fishing (half day)"));
});

test("22. tadoba 2n with naturalist on all safaris, booking 30 days before, 2 indian", () => {
  const r = conversation()("tadoba 2n with naturalist on all safaris, booking 30 days before, 2 indian");
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights, s.want_naturalists]), [["TAD", 2, -1]]);
  assert.equal(r.plan.guest.adults, 2);
  assert.equal(r.plan.guest.country, "IN");
  assert.match(r.reply.text, /When do they arrive/);
});

test("23. 4N4D kanha bandhavgarh, 2 adults, jbp in out, 1st week of feb: asks the split and the date", () => {
  const say = conversation();
  let r = say("4N4D kanha bandhavgarh, 2 adults, jbp in out, 1st week of feb");
  assert.deepEqual(r.plan.stops.map((s) => s.park_id), ["KAN", "BAN"]);
  assert.match(r.reply.text, /4 nights in all: how many in Kanha and how many in Bandhavgarh\? How many nights in Kanha/);
  r = say("2");
  r = say("2");
  assert.deepEqual(r.plan.stops.map((s) => s.nights), [2, 2]);
  assert.match(r.reply.text, /"1st week of feb": what is the exact arrival date\?/);
  assert.ok(r.reply.quick?.some((q) => q.label === "Dates not fixed"));
});

test("24. Pench in july 2 nights: monsoon note, asks guests and date", () => {
  const r = conversation()("Pench in july 2 nights");
  assert.deepEqual(r.plan.stops.map((s) => [s.park_id, s.nights]), [["PEN", 2]]);
  assert.ok(r.reply.warnings?.some((w) => /monsoon: core zones are closed/.test(w)));
  assert.match(r.reply.text, /July: what is the exact arrival date/);
  assert.equal(check(r, "guests").ok, false);
});

test("25. Ranthambore 3 nights: not one of our parks", () => {
  const r = conversation()("Ranthambore 3 nights");
  assert.equal(r.plan.stops.length, 0);
  assert.ok(r.reply.warnings?.some((w) => /Ranthambore is not one of our parks/.test(w) && /Kanha/.test(w)));
  assert.match(r.reply.text, /Which parks/);
});

test("26. vegetarian, ground floor room for elderly mother (72): asks if she is a third adult", () => {
  const say = conversation();
  let r = say("2 adults US, 3 nights pench, they want vegetarian food and ground floor room for elderly mother (72)");
  assert.equal(r.plan.guest.adults, 2);
  assert.deepEqual(r.plan.requests, ["vegetarian", "elderly guests", "ground floor room"]);
  assert.match(check(r, "ask:adult-extra").text, /mother \(72\) travelling too, making 3 adults/);
  say("16 jan 27");
  say("nagpur in out");
  r = say("cottage");
  assert.match(r.reply.text, /mother \(72\) travelling too/);
  r = say("3 adults");
  assert.equal(r.plan.guest.adults, 3);
  assert.ok(!r.reply.checklist?.some((c) => c.key === "ask:adult-extra"));
});

test("27. same as last quote but 3 adults instead of 2", () => {
  const say = conversation();
  const before = say("2 adults, kanha 3n, jabalpur in out, 16 jan 27").plan;
  const r = say("same as last quote but 3 adults instead of 2");
  assert.equal(r.plan.guest.adults, 3);
  assert.equal(r.plan.guest.rooms, 2);
  assert.deepEqual(route(r.plan), route(before));
});

test("28. Bhopal airport pickup, Satpura 2n, then Pench 2n by our car, Nagpur drop", () => {
  const r = conversation()("Bhopal airport pickup, Satpura 2n, then Pench 2n by our car, Nagpur drop");
  assert.equal(r.plan.between_lodges, "ours");
  assert.deepEqual(roads({ ...r.plan, arrival_date: "2027-01-16" }), ["BHO>L_DBE", "L_DBE>L_PTL", "L_PTL>NAG"]);
});

test("29. guest flying delhi to raipur, kanha 3 nights, back raipur, flight 6:40 am: asks which flight", () => {
  const say = conversation();
  let r = say("guest flying delhi to raipur, kanha 3 nights, back raipur, flight 6:40 am, 2 adults, 16 jan 27, indian");
  assert.deepEqual(r.plan.flights, [{ from: "Delhi", to: "Raipur", time: "06:40" }]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["RPR", "RPR"]);
  assert.deepEqual(route(r.plan), ["KAN 3 KEL"]);
  assert.match(r.reply.text, /06:40 flight: is it the arrival flight \(Delhi to Raipur\) or the flight home\?/);
  r = say("Departure flight");
  assert.deepEqual(r.plan.flights, [{ from: "Delhi", to: "Raipur" }, { from: "Raipur", to: "Delhi", time: "06:40" }]);
});

test("30. the full multi-city trip: Delhi, six lodges with Kings and THH as two stops, Delhi", () => {
  const r = conversation()(
    "2 adults foreign, 20 dec delhi 1 night, flight to bhopal, satpura 2n, pench 2n, kanha 2n, bandhavgarh kings 1n, tree house 1n, tadoba 2n, nagpur to delhi flight, delhi 1 night, all stays nature walk and any special"
  );
  assert.deepEqual(route(r.plan), ["SAT 2 DBE", "PEN 2 PTL", "KAN 2 KEL", "BAN 1 KL", "BAN 1 THH", "TAD 2 WEL"]);
  assert.deepEqual(r.plan.city_stays?.map((c) => [c.when, c.city, c.nights]), [["before", "Delhi", 1], ["after", "Delhi", 1]]);
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Bhopal", "Nagpur>Delhi"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["BHO", "NAG"]);
  assert.equal(r.plan.arrival_date, "2026-12-21");
  assert.ok(r.plan.stops.every((s) => s.want_extras?.includes("nature walk") && s.want_extras.includes("special")));
});

// The enquiry of 30 Oct 2026, misread with the AI first (Kings Lodge, Kanha 2, Pench 1).
// The built-in reader alone reads it right; the AI may no longer override it (reading.test.ts).
test("31. Delhi, Tree House 3, Kanha 3, Pench 2, Nagpur to Delhi, Delhi, Jorhat, Kaziranga 3, back to Delhi", () => {
  const r = conversation(jorhatCtx)(DELHI_KAZIRANGA);
  assert.deepEqual(route(r.plan), ["BAN 3 THH", "KAN 3 KEL", "PEN 2 PTL", "KAZ 3 IORA"]);
  assert.deepEqual(r.plan.city_stays?.map((c) => [c.when, c.city, c.nights, c.at ?? null]), [["before", "Delhi", 1, null], ["after", "Delhi", 1, 3]]);
  assert.deepEqual(r.plan.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jabalpur", "Nagpur>Delhi", "Delhi>Jorhat", "Jorhat>Delhi"]);
  const days = r.plan.days;
  // Delhi the night of 1 Apr, the flight to Jabalpur on 2 Apr
  assert.equal(days[0].date, "2027-04-01");
  assert.equal(days[0].kind, "city");
  assert.equal(days[1].date, "2027-04-02");
  assert.ok(days[1].items.some((i) => i.type === "flight" && /Delhi to Jabalpur/.test(i.title)));
  assert.deepEqual(roads(r.plan).filter((x) => !x.includes("@")), ["JLR>L_THH", "L_THH>L_KEL", "L_KEL>L_PTL", "L_PTL>NAG", "JRH>L_IORA", "L_IORA>JRH"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JRH"]);
});
