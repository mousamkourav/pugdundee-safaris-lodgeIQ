// Run with:  npx tsx --test lib/sales/plan/planner.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDays, emptyPlan, planToTrip, defaultStop, describe } from "./planner";
import { priceTrip } from "@/lib/sales/pricing/engine";
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

function sheetPlan(): Plan {
  const p = emptyPlan("2026-10-05");
  p.guest = { ...p.guest, name: "Judy & Cathy Miller", adults: 2, rooms: 2 };
  p.arrival_date = "2027-01-16";
  p.arrival_location_id = "NAG";
  p.departure_location_id = "NAG";
  p.stops = [defaultStop(ctx, "TADOBA", 4), defaultStop(ctx, "PENCH", 3)];
  p.days = buildDays(p, ctx);
  return p;
}

test("defaults pick the lodge, room and AP meal plan", () => {
  assert.deepEqual(defaultStop(ctx, "TADOBA", 4), { park_id: "TADOBA", nights: 4, property_id: "WEL", room_category_id: "WEL_AC", meal_plan: "AP" });
});

test("route Tadoba 4 + Pench 3 builds the sheet's 8 days", () => {
  const p = sheetPlan();
  assert.equal(p.days.length, 8);
  assert.deepEqual(p.days.map((d) => d.kind), ["arrival", "safari", "safari", "safari", "transfer", "safari", "safari", "departure"]);
  // Tuesday 19 Jan: Tadoba core closed -> both safaris in the buffer zone
  const tue = p.days.find((d) => d.date === "2027-01-19")!;
  assert.deepEqual(tue.safaris.map((s) => s.zone), ["buffer", "buffer"]);
  assert.ok(tue.notes[0].includes("buffer can be used"));
  assert.ok(p.days[0].text.includes("Nagpur Airport") && p.days[0].text.includes("2.5 hours"));
});

test("the generated plan prices exactly like the sheet: 5,58,670", () => {
  const r = priceTrip(planToTrip(sheetPlan(), "2026-10-05"), data);
  assert.deepEqual(r.errors, []);
  assert.equal(r.totals.grand, 558670);
});

test("Pench on a Wednesday: afternoon core closed and no buffer rate -> morning only", () => {
  const p = emptyPlan("2026-10-05");
  p.arrival_date = "2027-01-19"; // Tue arrival, Wed is a full day
  p.stops = [defaultStop(ctx, "PENCH", 2)];
  p.guest.rooms = 1;
  const days = buildDays(p, ctx);
  const wed = days.find((d) => d.date === "2027-01-20")!;
  assert.deepEqual(wed.safaris, [{ session: "morning", zone: "core" }]);
  assert.ok(wed.notes[0].startsWith("No afternoon safari"));
});

test("items added by hand survive a rebuild and are priced", async () => {
  const { sanitizePlan } = await import("./sanitize");
  const p = sheetPlan();
  p.days[1].items = [{ id: "a", type: "activity", title: "Bush dinner", detail: "By the lake", price: 8000, addon_id: null, qty: null }];
  p.days[6].items = [{ id: "b", type: "note", title: "Birthday cake", detail: "", price: null, addon_id: null, qty: null }];
  // shorten Pench by a night: day 7 no longer exists -> its item moves to the last day
  p.stops[1].nights = 2;
  p.days = buildDays(p, ctx);
  assert.equal(p.days.length, 7);
  assert.equal(p.days[1].items[0].title, "Bush dinner"); // same date kept
  assert.ok(p.days.some((d) => d.items.some((i) => i.title === "Birthday cake")));
  const r = priceTrip(planToTrip(p, "2026-10-05"), data);
  assert.equal(r.totals.addon, 8000);
  // a saved plan keeps items and typed prices through the sanitizer
  p.manual_prices = { "transfer|2027-01-16|NAG|L_WEL": 7000 };
  const back = sanitizePlan(JSON.parse(JSON.stringify(p)))!;
  assert.equal(back.days[1].items[0].price, 8000);
  assert.equal(back.manual_prices["transfer|2027-01-16|NAG|L_WEL"], 7000);
});

test("day text: no 'resident naturalist'; naturalist sentence only when ticked; flights priced as flights", () => {
  const p = sheetPlan();
  const safariDay = p.days.find((d) => d.kind === "safari")!;
  assert.ok(!/resident/i.test(safariDay.text), safariDay.text);
  assert.ok(!/naturalist/i.test(safariDay.text));
  const ticked = describe(ctx, { ...safariDay, safaris: safariDay.safaris.map((s, i) => ({ ...s, naturalist: i === 0 })) }, null);
  assert.match(ticked.text, /naturalist accompanies the morning safari/);
  const both = describe(ctx, { ...safariDay, safaris: safariDay.safaris.map((s) => ({ ...s, naturalist: true })) }, null);
  assert.match(both.text, /Each safari is accompanied by a naturalist/);
  p.days[0].items = [{ id: "f", type: "flight", title: "Flight Delhi to Nagpur", detail: "", price: 12000, addon_id: null, qty: null, flight: { from: "Delhi", to: "Nagpur", airline: "IndiGo", number: "6E 123", time: "08:30", pnr: "" } }];
  const t = planToTrip(p, "2026-10-05");
  assert.deepEqual(t.custom_items, [{ date: p.days[0].date, title: "Flight Delhi to Nagpur", amount: 12000, group: "flight" }]);
});

test("the plan honours wishes, city nights and flights; edited flights survive a rebuild", () => {
  const p = sheetPlan();
  p.stops[0] = { ...p.stops[0], want_safaris: 3, want_naturalists: 1, want_extras: ["nature walk"] };
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1 }, { when: "after", city: "Delhi", nights: 1 }];
  p.flights = [{ from: "Delhi", to: "Nagpur", time: "08:30" }, { from: "Nagpur", to: "Delhi" }];
  p.days = buildDays(p, ctx);
  assert.equal(p.days.length, 10); // 8 lodge days + Delhi before + Delhi at the end
  assert.equal(p.days[0].kind, "city");
  assert.equal(p.days[0].title, "Arrive in Delhi");
  assert.equal(p.days[9].title, "Depart from Delhi");
  const tadobaSafaris = p.days.filter((d) => d.park_id === "TADOBA").flatMap((d) => d.safaris);
  assert.equal(tadobaSafaris.length, 3);
  assert.equal(tadobaSafaris.filter((s) => s.naturalist).length, 1);
  assert.ok(p.days.some((d) => d.items.some((i) => i.auto?.startsWith("extra:0:nature walk"))));
  const inbound = p.days[1].items.find((i) => i.type === "flight")!;
  assert.equal(inbound.title, "Flight Delhi to Nagpur");
  assert.equal(p.days[8].items.find((i) => i.type === "flight")!.title, "Flight Nagpur to Delhi");
  // the sales person adds the ticket; a route change rebuilds the days; the ticket stays
  p.days[1].items = p.days[1].items.map((i) => (i.type === "flight" ? { ...i, flight: { ...i.flight!, airline: "IndiGo", pnr: "ABC123" } } : i));
  p.stops[1] = { ...p.stops[1], nights: 2 };
  p.days = buildDays(p, ctx);
  const kept = p.days.flatMap((d) => d.items).find((i) => i.title === "Flight Delhi to Nagpur")!;
  assert.equal(kept.flight!.pnr, "ABC123");
  assert.equal(p.days.flatMap((d) => d.items).filter((i) => i.type === "flight").length, 2); // no duplicates
  // city days cost nothing and do not change the lodge pricing
  assert.equal(priceTrip(planToTrip(p, "2026-10-05"), data).errors.length, 0);
});

test("extras priced by nationality: the guest's version is chosen", async () => {
  const { findAddon } = await import("./planner");
  const boats = {
    ...ctx,
    pricing: {
      ...ctx.pricing,
      addons: [
        { id: "BI", name: "Boat safari, 2 hours, up to 2 guests (Indian nationals)", property_id: "PTL", pricing_unit: "per_group" as const, rate: 10000, tax_pct: 5, active: true },
        { id: "BF", name: "Boat safari, 2 hours, up to 2 guests (foreign nationals)", property_id: "PTL", pricing_unit: "per_group" as const, rate: 14000, tax_pct: 5, active: true },
        { id: "BX", name: "Boat trip: each extra guest (Indian nationals)", property_id: "PTL", pricing_unit: "per_person" as const, rate: 750, tax_pct: 5, active: true },
      ],
    },
  };
  assert.equal(findAddon(boats, "PTL", "boat safari", "foreign")!.id, "BF");
  assert.equal(findAddon(boats, "PTL", "boat safari", "indian")!.id, "BI");
  assert.equal(findAddon(boats, "PTL", "boat safari")!.id, "BI"); // unknown: the cheaper one
});

test("city hotel nights are priced as City hotels; short stays still get the safaris asked for", async () => {
  const { priceBreakdown } = await import("@/lib/sales/pricing/breakdown");
  const p = sheetPlan();
  p.city_stays = [{ when: "before", city: "Delhi", nights: 1, hotel: "The Imperial", price: 18000 }, { when: "after", city: "Delhi", nights: 1, hotel: "The Imperial", price: 18000 }];
  p.stops[1] = { ...p.stops[1], nights: 1, want_safaris: 1 };
  p.days = buildDays(p, ctx);
  assert.match(p.days[0].text, /Overnight at The Imperial, Delhi/);
  const pench = p.days.filter((d) => d.park_id === "PENCH").flatMap((d) => d.safaris);
  assert.equal(pench.length, 1);
  const r = priceTrip(planToTrip(p, "2026-10-05"), data);
  const b = priceBreakdown(r);
  assert.equal(b.rows.find((x) => x.key === "hotels")!.amount, 36000);
  assert.equal(b.total, r.totals.grand);
});

test("short park names and a steady headline", async () => {
  const { shortPark, headlineFor } = await import("./draft");
  assert.equal(shortPark("Tadoba-Andhari Tiger Reserve"), "Tadoba");
  assert.equal(shortPark("Pench National Park"), "Pench");
  assert.equal(shortPark("Satpura Tiger Reserve"), "Satpura");
  assert.equal(headlineFor("a|b"), headlineFor("a|b"));
  assert.ok(headlineFor("a|b").split(" ").length <= 6);
});

test("nights in a city at the end: drive there from the last lodge, fly out after the city nights", () => {
  const p = sheetPlan();
  p.city_stays = [{ when: "after", city: "Khajuraho", nights: 2, hotel: "Radisson Hotel Jass Khajuraho" }];
  p.flights = [{ from: "Khajuraho", to: "Delhi" }];
  p.days = buildDays(p, ctx);
  const n = p.days.length;
  const drive = p.days[n - 3];
  assert.equal(drive.kind, "departure");
  assert.equal(drive.title, "Drive to Khajuraho");
  assert.match(drive.text, /^After breakfast, drive to Khajuraho.*Overnight at Radisson Hotel Jass Khajuraho, Khajuraho\.$/);
  assert.doesNotMatch(drive.text, /onward journey/);
  assert.ok(!drive.items.some((i) => i.type === "flight"));
  assert.equal(p.days[n - 1].title, "Depart from Khajuraho");
  assert.equal(p.days[n - 1].items.find((i) => i.type === "flight")!.title, "Flight Khajuraho to Delhi");
});
