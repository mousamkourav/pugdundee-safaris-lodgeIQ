// Run with:  npx tsx --test lib/sales/plan/use-cases.test.ts
//
// The Sales use cases, end to end, on the owner's REAL Master data (real-master.data.ts, export
// of 2 Nov 2026): the enquiry is read by the built-in reader (chatTurn), confirmed, priced by the
// engine, and checked with the same hard checks as saveItinerary. Every case asserts the final
// ROUTE (day by day: where they sleep, every drive, car and flight) AND the exact TOTAL.
//
// The export is used EXACTLY as exported. Our lodges' rooms are priced by the "... per BAR policy"
// rows (lodge exceptions, all guests, priority 10): the owner's BAR sheets for 2026-27, "Per night
// tariff for Indian Nationals, 01 Oct 2026 to 30 Jun 2027". Cottage / bungalow double: Shoulder
// 18,000, High 22,000, Peak 23,000; Treehouse double 21,000 / 25,500 / 26,500. Shoulder 1-31 Oct,
// 1-20 Dec, 5-31 Jan, 16 May-30 Jun; High Nov, 1 Feb-30 Apr, 1-15 May; Peak 21 Dec-4 Jan and the
// long weekends (Dussehra 17-20 Oct, Diwali 6-14 Nov, Holi 19-22 Mar). The "published tariff"
// 30,000 / 33,000 is the rack rate, not what Indian guests are sold. Foreign guests get the same
// seasonal rates today (open question for management, not a test).
//
// Totals are in rupees incl. GST. The sums are worked out in the comments from the rates in the
// export (room rate x 1.18, safari / transfer x 1.05) so a changed total is a real change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags, type ChatFlags } from "./chat";
import { buildDays, emptyPlan, planToTrip } from "./planner";
import { editStop, isConfirmed, markConfirmed } from "./confirm";
import { quoteChecks } from "./checks";
import { sanitizePlan } from "./sanitize";
import { extractTrip, scrubForAI } from "./parse-text";
import { parseCities } from "./car-packages";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { Addon, CarPackage, PriceResult } from "@/lib/sales/pricing/types";
import { canUpdateInPlace, defaultVersionMode } from "@/lib/sales/versions";
import { canMoveStatus, NEXT_STATUS, QUERY_STATUSES } from "@/lib/sales/status";
import { isSalesAdmin, isSalesUser, isSalesOnly, homePathFor } from "@/lib/auth";
import { realCtx } from "./real-fixture";
import type { BuilderContext, Plan } from "./types";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TODAY = "2026-11-02";

// ---------------------------------------------------------------- the data

const ctx: BuilderContext = realCtx;

// ---------------------------------------------------------------- helpers

function read(c: BuilderContext, ...msgs: string[]) {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, c, TODAY);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const name = (c: BuilderContext, id: string | null | undefined) =>
  !id ? "-" : c.locations.find((l) => l.id === id)?.name ?? c.properties.find((p) => p.id === id)?.name ?? id;
// the route, one line per day: "02-12 Kanha Earth Lodge | drive Jabalpur Airport>Kanha Earth Lodge | 2 safaris"
function route(p: Plan, c: BuilderContext = ctx) {
  return p.days.map((d) => {
    const parts = [`${d.date.slice(5)} ${name(c, d.property_id)}`];
    if (d.transfer) parts.push(`drive ${name(c, d.transfer.from_location_id)}>${name(c, d.transfer.to_location_id)}`);
    for (const t of d.city_transfers ?? []) parts.push(`car ${t.from_label || name(c, t.from_location_id)}>${t.to_label || name(c, t.to_location_id)}`);
    for (const i of d.items) if (i.type === "flight") parts.push(i.title);
    if (d.safaris.length) parts.push(`${d.safaris.length} safari${d.safaris.length === 1 ? "" : "s"}`);
    return parts.join(" | ");
  });
}
function quote(p: Plan, c: BuilderContext = ctx) {
  const confirmed = markConfirmed(p, TODAY);
  const r = priceTrip(planToTrip(confirmed, TODAY), c.pricing);
  return { r, checks: quoteChecks(confirmed, c, r) };
}
const sumOf = (r: PriceResult, kind: string) => r.lines.filter((l) => l.kind === kind).reduce((t, l) => t + l.amount, 0);
// a quote ready for the guest: no hard check fails, nothing missing, no engine error, lines add up
function ready(r: PriceResult, checks: string[]) {
  assert.deepEqual(checks, []);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.missing.map((m) => m.label), []);
  assert.equal(r.lines.reduce((t, l) => t + l.amount, 0), r.totals.grand, "the lines add up to the total");
}

// ---------------------------------------------------------------- Indian vs foreign

const KANHA = "kanha 3 nights at kanha earth lodge from 10 jan 2027, arriving and departing jabalpur";
const KANHA_ROUTE = [
  "01-10 Kanha Earth Lodge | drive Jabalpur Airport>Kanha Earth Lodge",
  "01-11 Kanha Earth Lodge | 2 safaris",
  "01-12 Kanha Earth Lodge | 2 safaris",
  "01-13 - | drive Kanha Earth Lodge>Jabalpur Airport",
];

test("Indian guests: the BAR rate for the season (January = shoulder), Indian safari rates", () => {
  const p = read(ctx, `2 adults indian, ${KANHA}`);
  assert.equal(p.guest.nationality, "indian");
  assert.deepEqual(route(p), KANHA_ROUTE);
  const { r, checks } = quote(p);
  ready(r, checks);
  // rooms 3 x 18,000 (shoulder) x 1.18 = 63,720; safaris 4 x 14,500 x 1.05 = 60,900; drives 2 x 7,500 x 1.05 = 15,750
  // 63,720 + 60,900 + 15,750 = 1,40,370
  assert.equal(sumOf(r, "room"), 63_720);
  assert.equal(sumOf(r, "safari"), 60_900);
  assert.equal(sumOf(r, "transfer"), 15_750);
  assert.equal(r.totals.grand, 140_370);
});

test("foreign guests: the seasonal rate (January = shoulder), foreign safari rates", () => {
  const p = read(ctx, `2 adults from UK, ${KANHA}`);
  assert.equal(p.guest.nationality, "foreign");
  assert.deepEqual(route(p), KANHA_ROUTE);
  const { r, checks } = quote(p);
  ready(r, checks);
  // rooms 3 x 18,000 x 1.18 = 63,720; safaris 4 x 17,500 x 1.05 = 73,500; drives 15,750
  // 63,720 + 73,500 + 15,750 = 1,52,970
  assert.equal(sumOf(r, "room"), 63_720);
  assert.equal(sumOf(r, "safari"), 73_500);
  assert.equal(r.totals.grand, 152_970);
});

// ---------------------------------------------------------------- children and infants

test("a child of 8 pays 25% of the double, an infant of 1 is free; one jeep and an Innova for four", () => {
  const p = read(ctx, "2 adults + 2 children 8 and 1 year indian, pench 2 nights at pench tree lodge from 15 feb 2027, arriving and departing nagpur");
  assert.deepEqual([p.guest.adults, p.guest.children], [2, [8, 1]]);
  assert.deepEqual(route(p), [
    "02-15 Pench Tree Lodge | drive Nagpur Airport>Pench Tree Lodge",
    "02-16 Pench Tree Lodge | 2 safaris",
    "02-17 - | drive Pench Tree Lodge>Nagpur Airport",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  // February = high: room (22,000 + 25% child 5,500) x 1.18 = 32,450 a night x 2 = 64,900; infant free
  assert.equal(sumOf(r, "room"), 64_900);
  // safaris 2 x 14,500 x 1.05 = 30,450 (one jeep); Innova 2 x 9,000 x 1.05 = 18,900
  assert.equal(sumOf(r, "safari"), 30_450);
  assert.equal(sumOf(r, "transfer"), 18_900);
  assert.ok(r.lines.filter((l) => l.kind === "transfer").every((l) => /Innova/.test(l.description)));
  // 64,900 + 30,450 + 18,900 = 1,14,250
  assert.equal(r.totals.grand, 114_250);
});

// ---------------------------------------------------------------- dates fixed and not fixed

test("dates not fixed: Day 1, 2... priced by season, and the quote is still checked", () => {
  const p = read(ctx, "2 adults indian, bandhavgarh 3 nights kings lodge, dates not fixed, arriving and departing jabalpur");
  assert.equal(p.dateless, true);
  assert.equal(p.stops.length, 1);
  assert.equal(route(p).length, 4);
  assert.match(route(p)[0], /Kings Lodge \| drive Jabalpur Airport>Kings Lodge$/);
  assert.match(route(p)[3], /- \| drive Kings Lodge>Jabalpur Airport$/);
  const { r, checks } = quote(p);
  ready(r, checks);
  // no dates: priced on the default basis, high season: 3 x 22,000 x 1.18 = 77,880
  // safaris 4 x 14,500 x 1.05 = 60,900; Jabalpur drives 2 x 7,000 x 1.05 = 14,700
  // 77,880 + 60,900 + 14,700 = 1,53,480
  assert.deepEqual([sumOf(r, "room"), sumOf(r, "safari"), sumOf(r, "transfer")], [77_880, 60_900, 14_700]);
  assert.equal(r.totals.grand, 153_480);
  // a check on a trip without dates speaks of "Day 1", never of the placeholder date
  const open = read(ctx, "2 adults indian, bandhavgarh 3 nights kings lodge, dates not fixed");
  const c = quote(open).checks;
  assert.ok(c.includes("Kings Lodge: no way in on Day 1. Set where our car picks them up (Trip step: arrival point), add the flight before it, or mark their own vehicle."), c.join(" / "));
  assert.ok(c.some((x) => /no way out on Day 4\./.test(x)), c.join(" / "));
  assert.ok(!c.some((x) => /\d{4}-\d{2}-\d{2}/.test(x)));
});

// ---------------------------------------------------------------- peak, long weekend, New Year, monsoon

test("New Year (foreign, Tadoba): the peak rate, and the 1 Jan safaris at the holiday rate", () => {
  const p = read(ctx, "2 adults from USA, tadoba 3 nights at waghoba eco lodge from 30 dec 2026, arriving and departing nagpur");
  assert.deepEqual(route(p), [
    "12-30 Waghoba Eco Lodge | drive Nagpur Airport>Waghoba Eco Lodge",
    "12-31 Waghoba Eco Lodge | 2 safaris",
    "01-01 Waghoba Eco Lodge | 2 safaris",
    "01-02 - | drive Waghoba Eco Lodge>Nagpur Airport",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  // peak 23,000 x 1.18 = 27,140 x 3 = 81,420
  assert.equal(sumOf(r, "room"), 81_420);
  // 31 Dec 2 x 11,500 x 1.05 = 24,150; 1 Jan (festive) 2 x 14,500 x 1.05 = 30,450
  assert.deepEqual(r.lines.filter((l) => l.kind === "safari").map((l) => l.amount), [12_075, 12_075, 15_225, 15_225]);
  assert.equal(r.totals.grand, 149_670);
});

test("Diwali long weekend (Ken River, Indian): no safaris on the closed day, said on the day", () => {
  const p = read(ctx, "2 adults indian, ken river lodge 2 nights from 7 nov 2026, arriving and departing khajuraho");
  assert.deepEqual(route(p), [
    "11-07 Ken River Lodge | drive Khajuraho Airport>Ken River Lodge",
    "11-08 Ken River Lodge",
    "11-09 - | drive Ken River Lodge>Khajuraho Airport",
  ]);
  assert.deepEqual(p.days[1].notes, ["No morning safari: park closed Sun (Diwali).", "No afternoon safari: park closed Sun (Diwali)."]);
  const { r, checks } = quote(p);
  ready(r, checks);
  assert.equal(sumOf(r, "safari"), 0);
  assert.equal(r.totals.grand, 40_800);
});

test("monsoon (Bandhavgarh in August): the core is closed, every safari in the buffer", () => {
  const p = read(ctx, "2 adults indian, bandhavgarh 3 nights kings lodge from 10 aug 2027, arriving and departing jabalpur");
  assert.deepEqual(route(p), [
    "08-10 Kings Lodge | drive Jabalpur Airport>Kings Lodge",
    "08-11 Kings Lodge | 2 safaris",
    "08-12 Kings Lodge | 2 safaris",
    "08-13 - | drive Kings Lodge>Jabalpur Airport",
  ]);
  assert.ok(p.days.flatMap((d) => d.safaris).every((s) => s.zone === "buffer"));
  assert.ok(p.days.flatMap((d) => d.notes).some((n) => /monsoon closure/.test(n)));
  const { r, checks } = quote(p);
  ready(r, checks);
  // August 2027 is after the BAR sheet (to 30 Jun 2027): the export's row from 1 Jul 2027, 30,000
  // rooms 3 x 30,000 x 1.18 = 1,06,200; buffer safaris 4 x 13,500 x 1.05 = 56,700; drives 14,700
  // 1,06,200 + 56,700 + 14,700 = 1,77,600
  assert.deepEqual([sumOf(r, "room"), sumOf(r, "safari"), sumOf(r, "transfer")], [106_200, 56_700, 14_700]);
  assert.equal(r.totals.grand, 177_600);
});

// ---------------------------------------------------------------- single, multi-lodge, same park

const MULTI = "2 adults from UK, kanha 3 nights kanha earth lodge then bandhavgarh 3 nights kings lodge from 12 feb 2027, arrive jabalpur depart jabalpur";
const MULTI_ROUTE = [
  "02-12 Kanha Earth Lodge | drive Jabalpur Airport>Kanha Earth Lodge",
  "02-13 Kanha Earth Lodge | 2 safaris",
  "02-14 Kanha Earth Lodge | 2 safaris",
  "02-15 Kings Lodge | drive Kanha Earth Lodge>Kings Lodge",
  "02-16 Kings Lodge | 2 safaris",
  "02-17 Kings Lodge | 2 safaris",
  "02-18 - | drive Kings Lodge>Jabalpur Airport",
];
const multi = read(ctx, MULTI);
const MULTI_TOTAL = 325_335; // rooms 6 x 25,960 = 1,55,760; safaris 1,44,375; drives 7,875 + 9,975 + 7,350 = 25,200

test("two of our lodges: lodge to lodge by road; the multi-lodge offer is suggested, applied once ticked", () => {
  assert.deepEqual(route(multi), MULTI_ROUTE);
  const { r, checks } = quote(multi);
  ready(r, checks);
  assert.deepEqual([sumOf(r, "room"), sumOf(r, "safari"), sumOf(r, "transfer")], [155_760, 144_375, 25_200]);
  assert.equal(r.totals.grand, MULTI_TOTAL);
  assert.ok(r.warnings.some((w) => /qualifies for "Any 2 Pugdundee lodges, 6 nights or more" \(10% off\)/.test(w)));
  const offer = ctx.pricing.offers.find((o) => o.name === "Any 2 Pugdundee lodges, 6 nights or more")!;
  const ticked = quote({ ...multi, offer_ids: [offer.id] }).r;
  // 10% of the rooms (1,55,760) = 15,576
  assert.equal(sumOf(ticked, "discount"), -15_576);
  assert.equal(ticked.totals.grand, MULTI_TOTAL - 15_576);
});

test("two lodges in the same park: one drive between them, a safari on the move day", () => {
  const p = read(ctx, "2 adults from UK, bandhavgarh 2 nights kings lodge then 2 nights tree house hideaway from 12 feb 2027, arriving and departing jabalpur");
  assert.deepEqual(route(p), [
    "02-12 Kings Lodge | drive Jabalpur Airport>Kings Lodge",
    "02-13 Kings Lodge | 2 safaris",
    "02-14 Tree House Hideaway | drive Kings Lodge>Tree House Hideaway | 1 safari",
    "02-15 Tree House Hideaway | 2 safaris",
    "02-16 - | drive Tree House Hideaway>Jabalpur Airport",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  assert.equal(r.totals.grand, 218_675);
});

// ---------------------------------------------------------------- city nights, Roseate, flights

test("Delhi before the lodges: Roseate House, the car to and from the hotel, the flight on the lodge day", () => {
  const p = read(ctx, "2 adults from UK, 1 night delhi then fly to nagpur, pench 3 nights pench tree lodge from 12 feb 2027, depart nagpur");
  assert.equal(p.city_stays?.[0]?.hotel, "Roseate House");
  assert.deepEqual(route(p), [
    "02-11 - | car Delhi Airport (IGI)>Roseate House",
    "02-12 Pench Tree Lodge | drive Nagpur Airport>Pench Tree Lodge | car Roseate House>Delhi Airport (IGI) | Flight Delhi to Nagpur",
    "02-13 Pench Tree Lodge | 2 safaris",
    "02-14 Pench Tree Lodge | 2 safaris",
    "02-15 - | drive Pench Tree Lodge>Nagpur Airport",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  assert.equal(r.totals.grand, 199_520);
});

test("Delhi after the lodges: flight from the lodge's airport, two nights at Roseate House", () => {
  const p = read(ctx, "2 adults from UK, kanha 3 nights kanha earth lodge from 12 feb 2027 arriving jabalpur, then fly to delhi 2 nights");
  assert.deepEqual(route(p), [
    "02-12 Kanha Earth Lodge | drive Jabalpur Airport>Kanha Earth Lodge",
    "02-13 Kanha Earth Lodge | 2 safaris",
    "02-14 Kanha Earth Lodge | 2 safaris",
    "02-15 - | drive Kanha Earth Lodge>Jabalpur Airport | car Delhi Airport (IGI)>Roseate House | Flight Jabalpur to Delhi",
    "02-16 -",
    "02-17 - | car Roseate House>Delhi Airport (IGI)",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  assert.equal(r.totals.grand, 227_710);
});

test("Delhi in the middle: the trip still starts at Nagpur and ends at Jorhat (fixed 2 Nov 2026)", () => {
  const p = read(ctx, "2 adults from UK, arriving nagpur 12 feb 2027, pench 2 nights pench tree lodge, then fly to delhi 1 night, then fly to jorhat, kaziranga 2 nights iora, depart jorhat");
  assert.deepEqual(route(p), [
    "02-12 Pench Tree Lodge | drive Nagpur Airport>Pench Tree Lodge",
    "02-13 Pench Tree Lodge | 2 safaris",
    "02-14 - | car Pench Tree Lodge>Nagpur Airport | car Delhi Airport (IGI)>Roseate House | Flight Nagpur to Delhi",
    "02-15 Iora Retreat | drive Jorhat Airport>Iora Retreat | car Roseate House>Delhi Airport (IGI) | Flight Delhi to Jorhat",
    "02-16 Iora Retreat | 2 safaris",
    "02-17 - | drive Iora Retreat>Jorhat Airport",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  assert.equal(r.totals.grand, 224_710);
});

// KNOWN GAP (audit 2 Nov 2026): lodge to lodge across regions with no city night between them
// ("pench 2 nights, then kaziranga 2 nights") gets no flight and no airport drives. It is SAFE:
// it is never priced as a drive, and the hard checks stop the quote until the flight is added.
// When the planner learns lodge > airport > flight > airport > lodge, turn this into a route test.
test("Pench then Kaziranga (no road, no city night): the flight Nagpur > Guwahati is planned, with the drives to and from the airports", () => {
  const p = read(ctx, "2 adults from UK, arriving nagpur 12 feb 2027, pench 2 nights pench tree lodge, then kaziranga 2 nights iora, depart guwahati");
  assert.deepEqual(route(p), [
    "02-12 Pench Tree Lodge | drive Nagpur Airport>Pench Tree Lodge",
    "02-13 Pench Tree Lodge | 2 safaris",
    "02-14 Iora Retreat | drive Guwahati Airport>Iora Retreat | car Pench Tree Lodge>Nagpur Airport | Flight Nagpur to Guwahati",
    "02-15 Iora Retreat | 2 safaris",
    "02-16 - | drive Iora Retreat>Guwahati Airport",
  ]);
  const { r, checks } = quote(p);
  // never a drive between the two lodges; the gap closed by the flight (audit finding 5, 3 Nov 2026)
  assert.ok(!r.lines.some((l) => l.kind === "transfer" && /Pench Tree Lodge to Iora Retreat/.test(l.description)));
  assert.deepEqual(checks.filter((c) => !/^Price needed/.test(c)), []);
  // 176,570 (rooms, safaris, Nagpur Airport > Pench 7,350, Iora > Guwahati Airport 13,650)
  // + Pench > Nagpur Airport 7,350 + Guwahati Airport > Iora 13,650 = 197,570 (the flight fare is typed)
  assert.equal(r.totals.grand, 197_570);
});

// ---------------------------------------------------------------- Kaziranga via Guwahati / Jorhat

for (const [airport, total] of [["guwahati", 143_400], ["jorhat", 137_100]] as const) {
  test(`Kaziranga via ${airport}: Iora Retreat (partner lodge) from and back to ${airport}`, () => {
    const p = read(ctx, `2 adults from UK, kaziranga 3 nights at iora from 12 feb 2027, arriving and departing ${airport}`);
    const A = airport === "guwahati" ? "Guwahati Airport" : "Jorhat Airport";
    assert.deepEqual(route(p), [
      `02-12 Iora Retreat | drive ${A}>Iora Retreat`,
      "02-13 Iora Retreat | 2 safaris",
      "02-14 Iora Retreat | 2 safaris",
      `02-15 - | drive Iora Retreat>${A}`,
    ]);
    const { r, checks } = quote(p);
    ready(r, checks);
    // rooms 3 x 15,000 x 1.18 = 53,100; safaris 4 x 15,000 x 1.05 = 63,000; drives 2 x 13,000 (Guwahati) / 10,000 (Jorhat) x 1.05
    // a partner lodge: no multi-lodge offer, no lodge discount
    assert.ok(!r.warnings.some((w) => /qualifies for/.test(w)));
    assert.equal(r.totals.grand, total);
  });
}

// ---------------------------------------------------------------- own vehicle, train

test("own vehicle: no transfer planned or charged, and no 'no way in / out' check", () => {
  const p = read(ctx, "2 adults indian, pench 2 nights pench tree lodge from 12 feb 2027, coming by own car");
  assert.deepEqual(route(p), ["02-12 Pench Tree Lodge", "02-13 Pench Tree Lodge | 2 safaris", "02-14 -"]);
  const { r, checks } = quote(p);
  ready(r, checks);
  assert.equal(sumOf(r, "transfer"), 0);
  // February = high: rooms 2 x 22,000 x 1.18 = 51,920; safaris 2 x 14,500 x 1.05 = 30,450
  // 51,920 + 30,450 = 82,370
  assert.equal(r.totals.grand, 82_370);
});

test("by train both ways at Itarsi (fixed 2 Nov 2026: 'arriving and departing by train at')", () => {
  const p = read(ctx, "2 adults indian, satpura 2 nights denwa backwater escape from 12 feb 2027, arriving and departing by train at itarsi");
  assert.deepEqual(route(p), [
    "02-12 Denwa Backwater Escape | drive Itarsi Railway Station>Denwa Backwater Escape",
    "02-13 Denwa Backwater Escape | 2 safaris",
    "02-14 - | drive Denwa Backwater Escape>Itarsi Railway Station",
  ]);
  const { r, checks } = quote(p);
  ready(r, checks);
  // February = high: rooms 2 x 22,000 x 1.18 = 51,920; safaris 2 x 13,500 x 1.05 = 28,350; drives 2 x 5,500 x 1.05 = 11,550
  // 51,920 + 28,350 + 11,550 = 91,820
  assert.equal(r.totals.grand, 91_820);
});

test("both ends in one phrase: 'arriving and departing', 'pickup and drop', 'arrival/departure'", () => {
  for (const both of ["arriving and departing jabalpur", "pickup and drop jabalpur", "arrival/departure jabalpur", "arriving and departing from jabalpur airport", "pick up & drop at jabalpur"]) {
    const t = extractTrip(`2 adults indian, kanha 3 nights at kanha earth lodge from 10 jan 2027, ${both}`, ctx, TODAY);
    assert.deepEqual([t.arrival_place, t.departure_place], ["Jabalpur Airport", "Jabalpur Airport"], both);
  }
  // two different places are still two different ends
  const t = extractTrip("2 adults indian, pench 2 nights then kanha 2 nights from 10 jan 2027, arriving nagpur and departing jabalpur", ctx, TODAY);
  assert.deepEqual([t.arrival_place, t.departure_place], ["Nagpur Airport", "Jabalpur Airport"]);
});

// ---------------------------------------------------------------- outstation car package

test("Delhi - Agra - Delhi by an outstation car package: one item, the drives not priced again", () => {
  const pkg = (id: string, r: string, nights: number, rate: number): CarPackage => ({ id, name: `${r} (${nights} nights)`, cities: parseCities(r), nights, vehicle_type: "Innova / Crysta", capacity: 6, rate, tax_pct: 5, valid_from: null, valid_to: "2027-09-30", active: true });
  const hotels = ctx.properties.filter((p) => p.name === "ITC Mughal");
  const guides: Addon[] = hotels.map((h) => ({ id: `G-${h.id}`, name: "Local guide, per day", property_id: h.id, pricing_unit: "per_group" as const, rate: 8000, tax_pct: 5, active: true }));
  const c: BuilderContext = { ...ctx, pricing: { ...ctx.pricing, carPackages: [pkg("CP2", "Delhi - Agra - Delhi", 2, 25000)], addons: [...ctx.pricing.addons, ...guides] } };
  const p = read(c, "2 adults indian, arriving delhi 10 jan 2027, 1 night delhi at roseate, fly to jabalpur, kings lodge 3 nights, then fly jabalpur to delhi and drive to agra 2 nights at itc mughal, then drive back to delhi for the flight home");
  const r = route(p, c);
  assert.equal(r[0], "01-10 - | car Delhi Airport (IGI)>Roseate House");
  assert.ok(r.some((l) => /Flight Delhi to Jabalpur/.test(l)));
  assert.ok(r.some((l) => /Flight Jabalpur to Delhi/.test(l)));
  const { r: priced } = quote(p, c);
  const pkgLines = priced.lines.filter((l) => l.kind === "transfer" && /^Delhi - Agra - Delhi/.test(l.description));
  assert.equal(pkgLines.length, 1);
  assert.equal(pkgLines[0].amount, 26_250); // 25,000 + 5%
  // the Delhi airport > Agra hotel and Agra hotel > Delhi airport drives are inside the package
  assert.ok(!priced.lines.some((l) => l.kind === "transfer" && /Agra/.test(l.description) && !/^Delhi - Agra - Delhi/.test(l.description)));
  assert.ok(!priced.missing.some((m) => /Transfer .*Agra|Transfer ITC Mughal/.test(m.label)));
});

// ---------------------------------------------------------------- discounts, markup, adjustment, currency

test("discount on our lodges' rooms, on the whole trip, markup, manual adjustment, quote in USD", () => {
  const price = (p: Plan) => quote(p).r;
  const lodges10 = price({ ...multi, discount: { pct: 10, scope: "lodges", reason: "repeat guest" } });
  assert.equal(sumOf(lodges10, "discount"), -15_576); // 10% of 1,55,760
  assert.equal(lodges10.totals.grand, MULTI_TOTAL - 15_576);

  const all5 = price({ ...multi, discount: { pct: 5, scope: "all", reason: "agent" } });
  assert.equal(all5.totals.grand, MULTI_TOTAL - 16_267); // 5% of 3,25,335 = 16,266.75

  const markup = price({ ...multi, markup_pct: 10 });
  assert.equal(markup.totals.markup, 32_534);
  assert.equal(markup.totals.grand, MULTI_TOTAL + 32_534);

  const adj = price({ ...multi, adjustment: { amount: -5000, reason: "round off" } });
  assert.equal(adj.totals.grand, MULTI_TOTAL - 5000);

  // a discount or an adjustment without a reason is refused
  assert.ok(price({ ...multi, discount: { pct: 10, scope: "lodges", reason: " " } }).errors.length > 0);
  assert.ok(price({ ...multi, adjustment: { amount: -5000, reason: "" } }).errors.length > 0);

  // USD at a typed 85: the rupee total is unchanged, the guest sees it divided by 85
  const usd = price({ ...multi, currency: "USD", fx_rate: 85 });
  assert.deepEqual([usd.currency, usd.fx, usd.totals.grand], ["USD", 85, MULTI_TOTAL]);
  assert.equal(Math.round((usd.totals.grand / 85) * 100) / 100, 3827.47);
});

// ---------------------------------------------------------------- edits and versions

test("an edit on the Confirm step changes the route and the total; the server reads the same plan", () => {
  const longer = editStop(multi, ctx, 0, { nights: 4 });
  const rebuilt = { ...longer, days: buildDays(longer, ctx) };
  assert.equal(isConfirmed(markConfirmed(multi, TODAY)), true);
  assert.equal(isConfirmed({ ...rebuilt, confirmed: markConfirmed(multi, TODAY).confirmed }), false, "a changed route needs a new Confirm");
  assert.equal(route(rebuilt).length, MULTI_ROUTE.length + 1);
  const { r, checks } = quote(rebuilt);
  ready(r, checks);
  // one more Kanha night (25,960) and its two safaris (2 x 18,375)
  assert.equal(r.totals.grand, MULTI_TOTAL + 25_960 + 2 * 18_375);
  // saveItinerary prices the sanitized plan: the same total as the browser
  const server = sanitizePlan(JSON.parse(JSON.stringify(markConfirmed(rebuilt, TODAY))))!;
  assert.equal(priceTrip(planToTrip(server, TODAY), ctx.pricing).totals.grand, r.totals.grand);
  assert.equal(isConfirmed(server), true, "the browser's Confirm is accepted by the server");
});

test("versions: an update in place before the quote is sent; a new version after; never for booked / lost / cancelled", () => {
  assert.equal(defaultVersionMode("draft"), "update");
  assert.equal(defaultVersionMode("open"), "update");
  for (const s of ["quoted", "booked", "lost", "cancelled"]) assert.equal(defaultVersionMode(s), "new");
  for (const s of ["draft", "open", "quoted"]) assert.equal(canUpdateInPlace(s), true);
  for (const s of ["booked", "lost", "cancelled", null]) assert.equal(canUpdateInPlace(s), false);
});

// ---------------------------------------------------------------- status workflow

test("status workflow: only the moves the database allows", () => {
  const allowed = QUERY_STATUSES.flatMap((f) => QUERY_STATUSES.filter((t) => canMoveStatus(f, t)).map((t) => `${f}>${t}`));
  assert.deepEqual(allowed, ["draft>open", "open>quoted", "open>booked", "open>lost", "quoted>open", "quoted>booked", "quoted>lost", "booked>cancelled", "lost>open", "cancelled>open"]);
  assert.equal(canMoveStatus("booked", "lost"), false);
  assert.equal(canMoveStatus("booked", "open"), false, "a booking is cancelled, never reopened directly");
  assert.equal(canMoveStatus("open", "open"), false);
  assert.equal(canMoveStatus(null, "open"), false);
  assert.equal(canMoveStatus("open", "deleted"), false);
  assert.equal(Object.keys(NEXT_STATUS).length, QUERY_STATUSES.length);
});

// ---------------------------------------------------------------- permissions

test("roles: a sales member is in Sales but not an admin, and never in Lodge Reporting", () => {
  assert.equal(isSalesUser("sales_member"), true);
  assert.equal(isSalesAdmin("sales_member"), false);
  assert.equal(isSalesOnly("sales_member"), true);
  assert.equal(homePathFor("sales_member"), "/sales");
  for (const r of ["sales_admin", "super_admin", "senior_manager"]) assert.equal(isSalesAdmin(r), true, r);
  for (const r of ["delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts", "task_creator", null, "", "SALES_ADMIN"]) {
    assert.equal(isSalesUser(r), false, String(r));
    assert.equal(isSalesAdmin(r), false, String(r));
  }
});

// Every server action and API route of Sales checks who is calling, on the server. A new action
// without a check fails here. Master data, members, imports and exports need a Sales admin.
test("every Sales server action and API route checks the caller's role on the server", () => {
  const root = join(__dirname, "..", "..", "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(root, "app", "(dashboard)", "sales"));
  walk(join(root, "app", "api", "sales"));
  const actions = files.filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")) || /[\\/]route\.ts$/.test(f));
  assert.ok(actions.length >= 9, `found ${actions.length}`);
  // API routes are for Sales admins, except the payments list export and receipts, which every
  // Sales user opens for their own bookings (row level security decides which)
  const adminOnly = /[\\/](admin|members)[\\/]|[\\/]api[\\/]sales[\\/](?!payments[\\/](export|attachment)[\\/])/;
  for (const f of actions) {
    const src = readFileSync(f, "utf8");
    const rel = f.slice(root.length + 1);
    // each exported function (or a guard it calls) reads the signed-in user
    assert.match(src, /getCurrentUser\(\)/, `${rel}: no getCurrentUser()`);
    if (adminOnly.test(f)) assert.match(src, /isSalesAdmin\(/, `${rel}: Sales admin only, but no isSalesAdmin()`);
    else assert.match(src, /isSalesUser\(|isSalesAdmin\(/, `${rel}: no Sales role check`);
    // every exported action is guarded: no exported function without a check in the file before it runs
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    for (const fn of exported) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      const end = body.indexOf("\nexport ", 10);
      const own = end > 0 ? body.slice(0, end) : body;
      const callsUnsafe = /(\w+Unsafe)\(/.exec(own)?.[1];
      const guarded =
        /getCurrentUser\(\)|requireSuper\(\)|requireSalesAdmin\(\)|guard\(\)/.test(own) ||
        (!!callsUnsafe && new RegExp(`function ${callsUnsafe}[\\s\\S]*?(getCurrentUser\\(\\)|requireSuper\\(\\)|requireSalesAdmin\\(\\)|guard\\(\\))`).test(src)) ||
        fn === "aiEnabled"; // reads one switch, no data
      assert.ok(guarded, `${rel}: ${fn}() does not check the caller`);
    }
  }
});

// ---------------------------------------------------------------- AI privacy

test("AI privacy: names, emails and phone numbers are removed; dates are kept", () => {
  const s = scrubForAI("Mr Sharma (rahul.sharma@gmail.com, +91 98765 43210) arriving 2027-01-16, kanha 3n", ["Rahul Sharma"]);
  assert.ok(!/sharma|rahul|@gmail|98765/i.test(s), s);
  assert.match(s, /2027-01-16/, "a date is not a phone number");
});
