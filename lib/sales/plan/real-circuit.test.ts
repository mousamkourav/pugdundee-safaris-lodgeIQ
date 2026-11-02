// Run with:  npx tsx --test lib/sales/plan/real-circuit.test.ts
// The owner's whole-circuit enquiry of 2 Nov 2026 on the REAL Master data (real-master.data.ts, from
// his export), not on made-up rows: every destination, airport, road and experience he sells. What is
// not in his Master data must be a "price needed" (named, with its lodge), nothing silently dropped or 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { airportServes, planToTrip } from "./planner";
import { emptyPlan } from "./planner";
import { tripChecklist } from "./checklist";
import { markConfirmed } from "./confirm";
import { addonTriggers } from "./parse-text";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { realCtx as ctx } from "./real-fixture";
import type { Plan } from "./types";

const TODAY = "2026-11-02";
export const OWNER_FULL_TEST = "Hi team pls make quote - 2 adlts + 1 child 8 yrs from UK, 1 room, arriving delhi on 10th jan'27. delhi one night stay with delhi sighseeing, local guide, accompanying guide and entrances, next day fly to jorhat, kaziranga 3 nigths at iora with 6 safaris and camera, than drive to guwahati and fly to bagdogra, siliguri 2 nights at mayfair chumta jungle view room, than fly bagdogra to delhi, delhi one night stay, then they will go to bhopal than satpura via bhimbetka 3 nights in forest suite with boat safari, canoe, buffer walk, tawa cruise, escorted nature walk, cycling, bush dinner and safari breakfast, than pench 3 nights in tree house room with 1 full day safari, 2 buffer safaris, buffer walk, village walk, cycling, culinary workshop and safari lunch, than tadoba 3 nights at waghoba with 1 full day safari, tadoba boat safari 1 hour, tadoba boat safari 2 hours, core safari from moharli gate, modified gypsy, modified scorpio, cycling, picnic lunch and bush dinner, than kanha 3 nights with 1 full day safari, buffer walk, cycling, special dinner, culinary workshop and picnic lunch, Bandhavgarh, 2 nights kings lodge with full day safari, cycling, village walk and safari breakfast then 2 nights tree house hideaway with bird watching, cycling, bush dinner and escorted nature walk, than ken river 3 nights with boat safari, night boat safari, half day fishing, full day fishing, island dinner, bush dinner, cycling, royal enfield and nature walk, than khajuraho 1 night with sightseeing guide and entrances, transfer to khajuraho for delhi flight drive direct to Agra for 2 nights stay with Agra sighseeing and local guide, than drive to jaipur 2 nights at itc rajputana with jaipur sightseeing, drive back to delhi for homebound flight. 2 gaadi for all transfers, sab safari naturalist ke saath and if any lodge is having unique expeirence add that also";

function read(...msgs: string[]) {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
  }
  return { plan, flags };
}
const lodge = (name: string) => ctx.properties.find((p) => p.name === name)!.id;
const place = (name: string) => ctx.locations.find((l) => l.name === name)!.id;
const day = (p: Plan, date: string) => p.days.find((d) => d.date === date)!;
const moves = (p: Plan, date: string) => [
  ...(day(p, date).transfer ? [`${day(p, date).transfer!.from_location_id}>${day(p, date).transfer!.to_location_id}`] : []),
  ...(day(p, date).city_transfers ?? []).map((t) => `${t.from_location_id}>${t.to_location_id}`),
];
const itemsAt = (p: Plan, name: string) =>
  p.days.filter((d) => d.property_id === lodge(name) && d.kind !== "departure").flatMap((d) => d.items.filter((i) => i.type !== "flight").map((i) => i.title)).sort();

const { plan: P, flags: F } = read(OWNER_FULL_TEST);
const priced = priceTrip(planToTrip(markConfirmed(P, TODAY), TODAY), ctx.pricing);

test("real data: Siliguri is reached through Bagdogra Airport (its road to Mayfair Chumta)", () => {
  assert.equal(airportServes(ctx, "Bagdogra", "Siliguri"), true);
  assert.equal(airportServes(ctx, "Guwahati", "Siliguri"), false);
});

test("real data: the route, every flight on its day, no impossible road, 2 vehicles", () => {
  assert.deepEqual(P.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jorhat", "Guwahati>Bagdogra", "Bagdogra>Delhi", "Delhi>Bhopal", "Khajuraho>Delhi"]);
  assert.deepEqual(P.stops.map((s) => `${ctx.properties.find((x) => x.id === s.property_id)!.name} ${s.nights}`), [
    "Iora Retreat 3", "Denwa Backwater Escape 3", "Pench Tree Lodge 3", "Waghoba Eco Lodge 3", "Kanha Earth Lodge 3", "Kings Lodge 2", "Tree House Hideaway 2", "Ken River Lodge 3",
  ]);
  assert.deepEqual(moves(P, "2027-01-14"), [`${place("Iora Retreat")}>${place("Guwahati Airport")}`, `${place("Bagdogra Airport")}>${place("Mayfair Chumta")}`]);
  assert.deepEqual(moves(P, "2027-01-16"), [`${place("Mayfair Chumta")}>${place("Bagdogra Airport")}`, `${place("Delhi Airport (IGI)")}>${place("Roseate House")}`]);
  assert.ok(day(P, "2027-02-06").items.some((i) => i.title === "Flight Khajuraho to Delhi"));
  assert.deepEqual(P.days.flatMap((d) => d.notes.filter((n) => /^No road between/.test(n))), []);
  assert.deepEqual([P.guest.adults, P.guest.children, P.transfer_vehicles], [2, [8], 2]);
  // Pench: 2 of its safaris in the buffer zone; a full day at Pench, Tadoba, Kanha and Kings Lodge; a naturalist on every safari
  assert.equal(P.days.filter((d) => d.property_id === lodge("Pench Tree Lodge")).flatMap((d) => d.safaris).filter((s) => s.zone === "buffer").length, 2);
  for (const l of ["Pench Tree Lodge", "Waghoba Eco Lodge", "Kanha Earth Lodge", "Kings Lodge"])
    assert.ok(P.days.some((d) => d.property_id === lodge(l) && d.safaris.some((s) => s.session === "full_day")), l);
  assert.ok(P.days.flatMap((d) => d.safaris).every((s) => s.naturalist));
});

test("real data: every experience asked for, by its name in Master data, at its lodge", () => {
  const has = (l: string, ...names: string[]) => { for (const n of names) assert.ok(itemsAt(P, l).includes(n), `${l}: ${n} (got ${itemsAt(P, l).join(" | ")})`); };
  has("Denwa Backwater Escape", "Boat safari, 2 hours", "Canoe ride", "Walking safari in buffer zone", "Tawa cruise to the lodge by boat (up to 8 guests)", "Bhopal transfer via Bhimbetka caves (extra, Innova / Crysta)", "Bush dinner experience", "Safari breakfast (outside jeeps)", "Nature walk / cycling / night trail");
  has("Waghoba Eco Lodge", "Boat safari - 1 hour", "Boat safari - 2 hours", "Moharli gate entry (per safari)", "Modified Gypsy (per safari)", "Modified Scorpio (per safari)", "Nature walk / cycling / night trail");
  has("Kanha Earth Lodge", "Banjar River picnic", "Nature walk / cycling / night trail");
  has("Kings Lodge", "Safari breakfast (outside jeeps)", "Nature walk / cycling / night trail");
  has("Tree House Hideaway", "Bush dinner experience", "Nature walk / cycling / night trail");
  has("Ken River Lodge", "Boat safari on the Ken, 1.5 hours with island high tea (up to 4 guests)", "Night boat safari on the Ken, 2 hours with island high tea (up to 4 guests)", "Fishing and angling, half day (up to 2 guests)", "Fishing, full day (morning + evening), max 2 guests", "Island dinner (Rs 15,000 per couple)", "Bush dinner experience", "Cycling, per hour", "Royal Enfield Bullet motorcycle, per day", "Nature walk, per hour (up to 2 guests)");
  // never the via-Tawa-Dam transfer for a Tawa cruise, never an "Extra lunch" for a "picnic lunch"
  assert.ok(!P.days.flatMap((d) => d.items).some((i) => /via Tawa Dam|^Extra lunch$/.test(i.title)));
  // Delhi: sightseeing car, local guide, accompanying guide, entrances
  assert.deepEqual(day(P, "2027-01-10").items.map((i) => i.title).sort(), ["Accompanying guide, per day", "Delhi monument entrances", "Delhi sightseeing: Innova, per day", "Delhi sightseeing: guide, per day"]);
});

test("real data: only what Master data does not have is a price to type, named with its lodge", () => {
  assert.deepEqual(priced.missing.map((m) => m.label).sort(), [
    "Agra local guide at Courtyard by Marriott Agra",
    "Agra sightseeing at Courtyard by Marriott Agra",
    "Bird watching at Tree House Hideaway",
    "Buffer walk at Kanha Earth Lodge",
    "Buffer walk at Pench Tree Lodge",
    "Bush dinner at Waghoba Eco Lodge",
    "Culinary workshop at Kanha Earth Lodge",
    "Culinary workshop at Pench Tree Lodge",
    "Jaipur sightseeing at ITC Rajputana",
    "Picnic at Waghoba Eco Lodge",
    "Special dinner at Kanha Earth Lodge",
    "Transfer Courtyard by Marriott Agra to ITC Rajputana",
    "Transfer Delhi Airport (IGI) to Courtyard by Marriott Agra",
    "Transfer ITC Rajputana to Delhi Airport (IGI)",
    "Village walk at Kings Lodge",
    "Village walk at Pench Tree Lodge",
  ]);
});

test("real data: the checklist says the day they land in Delhi, and Pench's buffer safaris", () => {
  const list = tripChecklist(P, F, ctx);
  assert.equal(list.find((c) => c.key === "date")!.text, "10 Jan 2027 in Delhi (first lodge 11 Jan 2027)");
  assert.ok(list.some((c) => /Pench/.test(c.label) && /2 buffer safaris/.test(c.text)));
});

test("an add-on is asked for by the word only it has; common words never pick one", () => {
  const places = new Set(["satpura", "tadoba", "ken", "kanha", "bhopal", "jabalpur", "khajuraho"]);
  assert.deepEqual(addonTriggers("Tawa cruise to the lodge by boat (up to 8 guests)", places).words, ["tawa", "cruise"]);
  assert.deepEqual(addonTriggers("Moharli gate entry (per safari)", places).words, ["moharli"]);
  assert.deepEqual(addonTriggers("Bhopal transfer via Bhimbetka caves (extra, Innova / Crysta)", places), { via: "bhimbetka", words: [] });
  assert.deepEqual(addonTriggers("Extra lunch", places).words, []);
  assert.deepEqual(addonTriggers("Walking safari in buffer zone", places).words, []);
});

test("with AI reading on: the AI's keywords and the reader's Master data names are both kept, the specific one wins", async () => {
  const { mergeAiFirst } = await import("./reading");
  const tadoba = "Tadoba-Andhari Tiger Reserve";
  const ai = { parks: [{ name: tadoba, nights: 3, extras: ["boat safari", "cycling"] }], notes: [] };
  const rule = { parks: [{ name: tadoba, nights: 3, extras: ["boat safari 1 hour", "boat safari 2 hour", "cycling", "moharli gate entry", "modified gypsy"] }], notes: [] };
  const { parsed } = mergeAiFirst(ai, rule);
  assert.deepEqual([...(parsed.parks[0].extras ?? [])].sort(), ["boat safari 1 hour", "boat safari 2 hour", "cycling", "modified gypsy", "moharli gate entry"]);
});
