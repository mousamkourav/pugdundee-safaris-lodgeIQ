// Run with:  npx tsx --test lib/sales/plan/ai-first.test.ts
// AI first, with a mocked Gemini. Each mock is the answer Gemini gives in the evidence format
// ({ value, quote } with the words of the message); it goes through exactly what the server and
// the browser do: checkEvidence (evidence.ts) -> aiToParsed (Master data) -> chatTurn (the
// reader fills only what the AI left empty). "AI down" is chatTurn with no AI reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aiToParsed } from "./ai";
import { chatTurn, initialFlags, type ChatFlags, type ChatResult } from "./chat";
import { checkEvidence } from "./evidence";
import { emptyPlan, planToTrip } from "./planner";
import { FRANCE_MISSPELT, roseateCtx as ctx, TEST_JORHAT } from "./reader-fixture";
import type { Plan } from "./types";

const TODAY = "2026-10-31";
const V = (value: unknown, quote: string) => ({ value, quote });

// One chat, with the mocked Gemini answering each message (null = the AI is down).
function chat() {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  return (msg: string, gemini: unknown | null): ChatResult => {
    const extra = gemini === null ? undefined : { parsed: aiToParsed(checkEvidence(gemini, msg, ctx).reading, ctx), source: "ai" as const };
    const r = chatTurn(plan, flags, msg, ctx, TODAY, extra);
    plan = r.plan;
    flags = r.flags;
    return r;
  };
}
const stops = (p: Plan) => p.stops.map((s) => `${s.property_id} ${s.nights}`);
const flights = (p: Plan) => (p.flights ?? []).map((f) => `${f.from}>${f.to}`);
const stays = (p: Plan) => (p.city_stays ?? []).map((c) => [c.when, c.city, c.nights, c.at ?? null, c.hotel ?? null]);
const roads = (p: Plan) => planToTrip(p, TODAY).transfers.map((t) => `${t.date.slice(5)} ${t.from_location_id}>${t.to_location_id}`);
const asks = (r: ChatResult) => (r.flags.asks ?? []).map((a) => a.key);

// ---------------- the Hinglish family enquiry (as the team typed it) ----------------
const HINGLISH_FAMILY =
  "sir ek family hai mumbai se, 2 adults aur 2 bacche (7 aur 12 saal), indian. 22 dec ko jabalpur flight se aa rahe hai. pehle kanha 3 raat chahiye, uske baad bandhavgarh 2 raat tree house hideaway me. sab safari naturalist ke saath, bacho ke liye nature walk bhi add kar dena. phir wapas jabalpur se flight lenge. new year se pehle nikal jayenge. budget theek hai";
const HINGLISH_GEMINI = {
  adults: V(2, "2 adults"),
  children_ages: V([7, 12], "7 aur 12 saal"),
  nationality: V("indian", "indian"),
  arrival_date: V("2026-12-22", "22 dec ko jabalpur flight se aa rahe hai"),
  arrival_place: V("Jabalpur Airport", "22 dec ko jabalpur flight se aa rahe hai"),
  arrival_mode: V("flight", "jabalpur flight se aa rahe hai"),
  departure_place: V("Jabalpur Airport", "phir wapas jabalpur se flight lenge"),
  departure_mode: V("flight", "wapas jabalpur se flight lenge"),
  stops: [
    { park: V("Kanha National Park", "pehle kanha 3 raat chahiye"), nights: V(3, "kanha 3 raat"), naturalists: V(-1, "sab safari naturalist ke saath") },
    {
      park: V("Bandhavgarh National Park", "bandhavgarh 2 raat tree house hideaway me"),
      lodge: V("Tree House Hideaway", "tree house hideaway"),
      nights: V(2, "bandhavgarh 2 raat"),
      naturalists: V(-1, "sab safari naturalist ke saath"),
      extras: [V("nature walk", "bacho ke liye nature walk bhi add kar dena")],
    },
  ],
};

test("Hinglish family: children 7 and 12, Tree House Hideaway, no age or New Year question", () => {
  const r = chat()(HINGLISH_FAMILY, HINGLISH_GEMINI);
  assert.deepEqual(r.plan.guest.children, [7, 12]);
  assert.equal(r.plan.guest.adults, 2);
  assert.equal(r.plan.guest.nationality, "indian");
  assert.equal(r.plan.arrival_date, "2026-12-22");
  assert.deepEqual(stops(r.plan), ["KEL 3", "THH 2"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JLR"]);
  assert.ok(r.plan.days.flatMap((d) => d.safaris).every((s) => s.naturalist));
  assert.ok(r.plan.stops[1].want_extras?.includes("nature walk"));
  // "new year se pehle nikal jayenge": they leave on 27 Dec, before New Year, so nothing to ask
  assert.ok(!asks(r).includes("ages"), asks(r).join(", "));
  assert.ok(!asks(r).includes("newyear"), asks(r).join(", "));
  assert.doesNotMatch(r.reply.text, /How old|New Year/);
  // the AI down: the built-in reader reads the same trip, ages included, with no question either
  const down = chat()(HINGLISH_FAMILY, null);
  assert.deepEqual(stops(down.plan), ["KEL 3", "THH 2"]);
  assert.deepEqual(down.plan.guest.children, [7, 12]);
  assert.deepEqual(asks(down), []);
});

test("New Year is still asked when the trip covers 31 Dec, or the nights are not known yet", () => {
  const over = chat()("2 adults indian, 29 dec, kanha 3 raat, jabalpur in out, new year wahan manayenge", null);
  assert.ok(asks(over).includes("newyear"));
  const unknown = chat()("2 adults indian, kanha, new year trip", null);
  assert.ok(asks(unknown).includes("newyear"));
});

// ---------------- the French Kaziranga enquiry (misspelt, no word "flight") ----------------
const FRANCE_GEMINI = {
  country: V("FR", "from france"),
  stops: [
    { park: V("Kaziranga National Park", "kaziranga 2 night stay"), nights: V(2, "kaziranga 2 night stay") },
    { park: V("Satpura Tiger Reserve", "satpura stay 2 nights"), nights: V(2, "satpura stay 2 nights"), naturalists: V(-1, "safaris with naturalist") },
    { park: V("Kanha National Park", "kanha 2 nights"), nights: V(2, "kanha 2 nights") },
    { park: V("Pench National Park", "2 nights pench"), nights: V(2, "2 nights pench") },
    { park: V("Tadoba-Andhari Tiger Reserve", "3 nigths waghoba"), lodge: V("Waghoba Eco Lodge", "waghoba"), nights: V(3, "3 nigths waghoba"), extras: [V("special", "any unique expeirence")] },
  ],
  city_stays: [
    { when: "before", city: V("Delhi", "to delhi one night stay"), nights: V(1, "delhi one night stay") },
    { when: "after", at: 1, city: V("Delhi", "come back to delhi"), nights: V(1, "come back to delhi one night stay") },
    { when: "after", city: V("Delhi", "1 night stay in the delhi"), nights: V(1, "1 night stay in the delhi") },
  ],
  flights: [{ from: "Nagpur", to: "Delhi", quote: "delhi from nagpur" }],
};

test("the French Kaziranga enquiry: the right trip, flights between regions without the word", () => {
  const r = chat()(FRANCE_MISSPELT, FRANCE_GEMINI);
  assert.deepEqual(stops(r.plan), ["IORA 2", "DBE 2", "KEL 2", "PTL 2", "WEL 3"]);
  assert.deepEqual(flights(r.plan), ["Delhi>Jorhat", "Jorhat>Delhi", "Delhi>Bhopal", "Nagpur>Delhi"]);
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JRH", "NAG"]);
  assert.equal(r.plan.guest.country, "FR");
  assert.ok(r.plan.days.flatMap((d) => d.safaris).every((s) => s.naturalist));
  for (const bad of ["DEL>L_IORA", "L_IORA>L_DBE", "L_WEL>DEL"]) assert.ok(!roads(r.plan).some((x) => x.endsWith(bad)), bad);
  // the AI down gives the same trip
  const down = chat()(FRANCE_MISSPELT, null);
  assert.deepEqual([stops(down.plan), flights(down.plan), roads(down.plan)], [stops(r.plan), flights(r.plan), roads(r.plan)]);
});

// ---------------- Test Jorhat ----------------
const JORHAT_GEMINI = {
  adults: V(2, "2 adults"),
  country: V("GB", "from UK"),
  rooms: V(1, "1 room"),
  // the day they land in Delhi: the trip date is the first lodge's (21 Apr)
  arrival_date: V("2027-04-20", "20 Apr 2027"),
  stops: [
    { park: V("Bandhavgarh National Park", "Tree House Hideaway 3 nights"), lodge: V("Tree House Hideaway", "Tree House Hideaway"), nights: V(3, "Tree House Hideaway 3 nights") },
    { park: V("Kanha National Park", "Kanha Earth Lodge 3 nights"), lodge: V("Kanha Earth Lodge", "Kanha Earth Lodge"), nights: V(3, "Kanha Earth Lodge 3 nights") },
    { park: V("Tadoba-Andhari Tiger Reserve", "Waghoba 4 nights"), lodge: V("Waghoba Eco Lodge", "Waghoba"), nights: V(4, "Waghoba 4 nights") },
    { park: V("Kaziranga National Park", "Iora Retreat 3 nights"), lodge: V("Iora Retreat", "Iora Retreat"), nights: V(3, "Iora Retreat 3 nights") },
  ],
  city_stays: [
    { when: "before", city: V("Delhi", "1 night Delhi at Roseate House"), nights: V(1, "1 night Delhi"), hotel: V("Roseate House", "Roseate House") },
    { when: "after", at: 3, city: V("Delhi", "1 night Delhi at Roseate House"), nights: V(1, "1 night Delhi"), hotel: V("Roseate House", "Roseate House") },
  ],
  flights: [
    { from: "Delhi", to: "Jabalpur", quote: "21 Apr flight Delhi to Jabalpur" },
    { from: "Nagpur", to: "Delhi", quote: "1 May flight Nagpur to Delhi" },
    { from: "Delhi", to: "Jorhat", quote: "2 May flight Delhi to Jorhat" },
    { from: "Jorhat", to: "Delhi", quote: "5 May flight Jorhat to Delhi" },
  ],
};
const JORHAT_ROADS = ["04-20 DEL>L_ROS", "04-21 JLR>L_THH", "04-21 L_ROS>DEL", "04-24 L_THH>L_KEL", "04-27 L_KEL>L_WEL", "05-01 L_WEL>NAG", "05-01 DEL>L_ROS", "05-02 JRH>L_IORA", "05-02 L_ROS>DEL", "05-05 L_IORA>JRH"];

test("Test Jorhat: Jabalpur is the way in, Jorhat only for Iora Retreat; the trip date is the first lodge's", () => {
  const r = chat()(TEST_JORHAT, JORHAT_GEMINI);
  assert.deepEqual(stops(r.plan), ["THH 3", "KEL 3", "WEL 4", "IORA 3"]);
  assert.equal(r.plan.arrival_date, "2027-04-21");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JRH"]);
  assert.deepEqual(flights(r.plan), ["Delhi>Jabalpur", "Nagpur>Delhi", "Delhi>Jorhat", "Jorhat>Delhi"]);
  assert.deepEqual(stays(r.plan), [["before", "Delhi", 1, null, "Roseate House"], ["after", "Delhi", 1, 3, "Roseate House"]]);
  assert.deepEqual(roads(r.plan), JORHAT_ROADS);
  assert.deepEqual(roads(chat()(TEST_JORHAT, null).plan), JORHAT_ROADS);
});

// ---------------- the German enquiry ----------------
const GERMANY =
  "2 adults from Germany, arriving Delhi 20 April 2027, 1 night Roseate House, next morning flight to Jabalpur, then Tree House Hideaway 3 nights with 4 safaris all with naturalist, then Kanha 2 nights bush dinner on last night, then Pench 2 nights, then drive to Nagpur and fly to Delhi, 1 night Roseate again, next day flight to Jorhat, Kaziranga Iora Retreat 2 nights with 2 jeep safaris and 1 camera, then fly Jorhat to Delhi and go home";
const GERMANY_GEMINI = {
  adults: V(2, "2 adults"),
  country: V("DE", "from Germany"),
  arrival_date: V("2027-04-20", "arriving Delhi 20 April 2027"),
  arrival_place: V("Jabalpur Airport", "next morning flight to Jabalpur"),
  departure_place: V("Jorhat Airport", "fly Jorhat to Delhi"),
  stops: [
    { park: V("Bandhavgarh National Park", "Tree House Hideaway 3 nights"), lodge: V("Tree House Hideaway", "Tree House Hideaway"), nights: V(3, "Tree House Hideaway 3 nights"), safaris: V(4, "4 safaris"), naturalists: V(-1, "4 safaris all with naturalist") },
    { park: V("Kanha National Park", "Kanha 2 nights"), nights: V(2, "Kanha 2 nights"), extras: [V("bush dinner", "bush dinner on last night")] },
    { park: V("Pench National Park", "Pench 2 nights"), nights: V(2, "Pench 2 nights") },
    { park: V("Kaziranga National Park", "Kaziranga Iora Retreat"), lodge: V("Iora Retreat", "Iora Retreat"), nights: V(2, "Iora Retreat 2 nights"), safaris: V(2, "2 jeep safaris"), extras: [V("camera", "1 camera")] },
  ],
  city_stays: [
    { when: "before", city: V("Delhi", "arriving Delhi"), nights: V(1, "1 night Roseate House"), hotel: V("Roseate House", "1 night Roseate House") },
    { when: "after", at: 3, city: V("Delhi", "fly to Delhi"), nights: V(1, "1 night Roseate again"), hotel: V("Roseate House", "Roseate again") },
  ],
  flights: [
    { from: "Delhi", to: "Jabalpur", quote: "next morning flight to Jabalpur" },
    { from: "Nagpur", to: "Delhi", quote: "drive to Nagpur and fly to Delhi" },
    { from: "Delhi", to: "Jorhat", quote: "next day flight to Jorhat" },
    { from: "Jorhat", to: "Delhi", quote: "fly Jorhat to Delhi" },
  ],
};

test("the German enquiry: Roseate House at the start and again in the middle, no Pench - Iora drive", () => {
  const r = chat()(GERMANY, GERMANY_GEMINI);
  assert.deepEqual(stops(r.plan), ["THH 3", "KEL 2", "PTL 2", "IORA 2"]);
  assert.equal(r.plan.arrival_date, "2027-04-21");
  assert.deepEqual(stays(r.plan), [["before", "Delhi", 1, null, "Roseate House"], ["after", "Delhi", 1, 3, "Roseate House"]]);
  assert.deepEqual(flights(r.plan), ["Delhi>Jabalpur", "Nagpur>Delhi", "Delhi>Jorhat", "Jorhat>Delhi"]);
  assert.ok(!roads(r.plan).some((x) => x.includes("L_PTL>L_IORA")));
  assert.equal(r.plan.stops[0].want_naturalists, -1);
  assert.deepEqual(r.plan.stops[1].want_extras, ["bush dinner"]);
  assert.deepEqual(roads(r.plan), roads(chat()(GERMANY, null).plan));
});

// ---------------- the Thompson enquiry ----------------
const THOMPSON =
  "Thompson family, 2 adults from UK, 10 feb 1 night delhi, next day fly to jabalpur, kanha 3 nights, bandhavgarh kings lodge 2 nights, back to jabalpur for the flight to delhi, 1 night delhi";
const THOMPSON_GEMINI = {
  adults: V(2, "2 adults"),
  country: V("GB", "from UK"),
  arrival_date: V("2027-02-10", "10 feb"),
  stops: [
    { park: V("Kanha National Park", "kanha 3 nights"), nights: V(3, "kanha 3 nights") },
    { park: V("Bandhavgarh National Park", "bandhavgarh kings lodge"), lodge: V("Kings Lodge", "kings lodge"), nights: V(2, "kings lodge 2 nights") },
  ],
  city_stays: [
    { when: "before", city: V("Delhi", "1 night delhi"), nights: V(1, "1 night delhi") },
    { when: "after", city: V("Delhi", "1 night delhi"), nights: V(1, "1 night delhi") },
  ],
  flights: [
    { from: "Delhi", to: "Jabalpur", quote: "next day fly to jabalpur" },
    { from: "Jabalpur", to: "Delhi", quote: "back to jabalpur for the flight to delhi" },
  ],
};

test("the Thompson enquiry: a Delhi night first, Jabalpur both ways, no question about the arrival", () => {
  const r = chat()(THOMPSON, THOMPSON_GEMINI);
  assert.deepEqual(stops(r.plan), ["KEL 3", "KL 2"]);
  assert.equal(r.plan.arrival_date, "2027-02-11");
  assert.deepEqual([r.plan.arrival_location_id, r.plan.departure_location_id], ["JLR", "JLR"]);
  assert.deepEqual(flights(r.plan), ["Delhi>Jabalpur", "Jabalpur>Delhi"]);
  assert.doesNotMatch(r.reply.text, /Where do they arrive|Where does our car pick them up/);
});

// ---------------- the evidence rule ----------------

test("an AI answer with a lodge or nights the message does not quote is rejected; the reader's stay", () => {
  const msg = "2 adults indian, bandhavgarh 3 nights, jabalpur in out, 10 jan 2027";
  const invented = {
    adults: V(2, "2 adults"),
    stops: [
      {
        park: V("Bandhavgarh National Park", "bandhavgarh 3 nights"),
        lodge: V("Kings Lodge", "bandhavgarh 3 nights"), // the quote does not name a lodge
        nights: V(5, "bandhavgarh 3 nights"), // the quote says 3
        room: V("tree", "bandhavgarh"), // no room is said
      },
    ],
    children_ages: V([8], "8 year old"), // not in the message
  };
  const { dropped } = checkEvidence(invented, msg, ctx);
  assert.deepEqual(dropped.map((d) => `${d.field}: ${d.reason}`).sort(), [
    "children_ages: quote not in the message",
    "stops[0].lodge: quote does not say it",
    "stops[0].nights: quote does not say it",
    "stops[0].room: quote does not say it",
  ]);
  const r = chat()(msg, invented);
  assert.equal(r.plan.stops[0].nights, 3);
  assert.deepEqual(r.plan.guest.children, []);
  // no lodge was said: the sales person is asked which one (never chosen by the AI)
  assert.ok(!(r.flags.lodgeDecided ?? []).includes("BAN"));
  assert.match(r.reply.text, /Kings Lodge or Tree House Hideaway/);
});

test("the AI down (off, failed, timed out, no credit): the built-in reader answers", () => {
  const r = chat()("2 adults indian, kanha 3 nights, 16 jan 2027, jabalpur in out", null);
  assert.deepEqual(stops(r.plan), ["KEL 3"]);
  assert.equal(r.reply.source, "built-in reader");
});
