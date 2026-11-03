// The owner's 22-night USA group enquiry of 3 Nov 2026, on his real Master data: every place,
// both Bandhavgarh lodges, the city nights after the lodges, the flights between regions,
// "dates are not fixed yet", and the wishes written once for the whole trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, DATELESS_RE, type ChatFlags } from "./chat";
import { emptyPlan, planToTrip } from "./planner";
import { markConfirmed } from "./confirm";
import { quoteChecks } from "./checks";
import { extractTrip } from "./parse-text";
import { mergeAiFirst } from "./reading";
import { cityHotels } from "./cities";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { realCtx as ctx } from "./real-fixture";
import type { Plan } from "./types";

const T = "2026-11-03";
const USA =
  "10 guests coming from us they land at delhi than they stay one night in delhi than they want to visit kaziranga stay there 3 nights and enjoy safaris than they want to visit satpura stay 3 days enjoy safaris with naturalist do boat safari bush dining than they will go to kanha same 3 nights safaris, special dinner, then pench 3 nights safaris, dinners, then bandhavgarh 4 nights 2 nights kings 2 nights three house than they will go to waghoba for 3 nights do safaris than they want to go khazuraho from nagpur airport 2 nights there they visit temples and all than 2 nights panna do all the special acitvites there as well than they will go back to delhi from khazuraho stay one night there than they want to go to agra and jaipur as well for 4 days than back to delhi and they will fly to usa create a proper and complete itineary for them they will do safaris with naturalists and want all the unique experience that we offer like cycling, walking and all of them";
function read(...msgs: string[]) {
  let plan: Plan = emptyPlan(T);
  let flags: ChatFlags = initialFlags(plan);
  let reply = chatTurn(plan, flags, "", ctx, T).reply;
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, ctx, T);
    plan = r.plan;
    flags = r.flags;
    reply = r.reply;
  }
  return { plan, reply };
}
const name = (id: string | null | undefined) => ctx.locations.find((l) => l.id === id)?.name ?? ctx.properties.find((p) => p.id === id)?.name ?? id;
const roads = (p: Plan, i: number) => [...(p.days[i].transfer ? [p.days[i].transfer!] : []), ...(p.days[i].city_transfers ?? [])].map((t) => `${name(t.from_location_id)} > ${name(t.to_location_id)}`);
const { plan: P, reply: R } = read(USA, "dates are not fixed yet proceed without date", "cottage", "cottage", "villa cottage");

test("USA group: every lodge with its nights, both Bandhavgarh lodges ('three house' = Tree House)", () => {
  assert.deepEqual(
    P.stops.map((s) => [name(s.property_id), s.nights]),
    [["Iora Retreat", 3], ["Denwa Backwater Escape", 3], ["Kanha Earth Lodge", 3], ["Pench Tree Lodge", 3], ["Kings Lodge", 2], ["Tree House Hideaway", 2], ["Waghoba Eco Lodge", 3], ["Ken River Lodge", 2]]
  );
});

test("USA group: the city nights after the lodges ('khazuraho', 'stay one night there', 'agra and jaipur for 4 days')", () => {
  assert.deepEqual(
    (P.city_stays ?? []).map((c) => [c.city, c.nights, c.at ?? c.when]),
    [["Delhi", 1, "before"], ["Khajuraho", 2, 7], ["Delhi", 1, "after"], ["Agra", 1, "after"], ["Jaipur", 2, "after"]]
  );
  assert.equal(P.end_city, "Delhi");
  assert.deepEqual((P.flights ?? []).map((f) => `${f.from}>${f.to}`), ["Delhi>Guwahati", "Guwahati>Bhopal", "Nagpur>Khajuraho", "Khajuraho>Delhi"]);
  assert.ok(extractTrip(USA, ctx, T, cityHotels(ctx)).notes.some((w) => /^Agra and Jaipur "for 4 days": read as Agra 1 night, Jaipur 2 nights\./.test(w)));
});

test("USA group: 'dates are not fixed yet proceed without date' quotes by season; no date asked again", () => {
  assert.equal(P.dateless, true);
  for (const s of ["dates are not fixed yet", "proceed without date", "no dates yet", "dates TBC", "date not decided", "dates not fixed"]) assert.ok(DATELESS_RE.test(s.toLowerCase()), s);
  assert.ok(!DATELESS_RE.test("arriving 10 jan 2027, dates fixed"));
});

test("USA group: flights between regions with the drives to and from the airports; Panna from Khajuraho by road", () => {
  const day = (title: RegExp) => P.days.findIndex((d) => title.test(d.title));
  assert.deepEqual(roads(P, day(/^Arrive Bhopal Airport, on to Denwa/)), ["Bhopal Airport > Denwa Backwater Escape", "Iora Retreat > Guwahati Airport"]);
  assert.deepEqual(roads(P, day(/^Fly to Khajuraho$/)), ["Waghoba Eco Lodge > Nagpur Airport", "Khajuraho Airport > Radisson Hotel Jass Khajuraho"]);
  assert.deepEqual(roads(P, day(/to Ken River Lodge$/)), ["Radisson Hotel Jass Khajuraho > Ken River Lodge"]);
  assert.deepEqual(roads(P, day(/^Fly to Delhi$/)), ["Ken River Lodge > Khajuraho Airport", "Delhi Airport (IGI) > Roseate House"]);
  assert.ok(P.days[day(/^Fly to Delhi$/)].items.some((i) => i.title === "Flight Khajuraho to Delhi"));
  assert.deepEqual(roads(P, P.days.length - 1), ["ITC Rajputana > Delhi Airport (IGI)"]);
  // no "how do they get from Iora Retreat to Denwa" question: the flight joins them
  assert.ok(!R.checklist?.some((c) => /far apart/.test(c.text)));
  const c = markConfirmed({ ...P, guest: { ...P.guest, name: "Test" } }, T);
  assert.deepEqual(quoteChecks(c, ctx, priceTrip(planToTrip(c, T), ctx.pricing)).filter((x) => !/^Price needed/.test(x)), []);
});

test("USA group: a wish written once for the whole trip goes to every lodge, never to the last one only", () => {
  for (const s of P.stops) {
    assert.equal(s.want_naturalists, -1, name(s.property_id) ?? "");
    for (const x of ["special", "cycling", "nature walk"]) assert.ok(s.want_extras?.includes(x), `${name(s.property_id)}: ${x}`);
  }
  // "do all the special activities there" stays Panna's own (no trip-wide wish from it alone)
  const own = extractTrip("2 adults, 10 jan 2027, kanha 3 nights then 2 nights panna do all the special activities there", ctx, T, cityHotels(ctx));
  assert.deepEqual(own.parks.map((p) => p.extras ?? []), [[], ["special"]]);
});

test("with AI reading on: the same lodge twice from the AI, two lodges from the reader: the reader's", () => {
  const rule = extractTrip(USA, ctx, T, cityHotels(ctx));
  const ai = { ...rule, parks: rule.parks.map((p) => (p.lodge === "Tree House Hideaway" ? { ...p, lodge: "Kings Lodge" } : p)) };
  const { parsed } = mergeAiFirst(ai, rule);
  assert.deepEqual(parsed.parks.filter((p) => p.name === "Bandhavgarh National Park").map((p) => p.lodge), ["Kings Lodge", "Tree House Hideaway"]);
});
