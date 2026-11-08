// The G. Manager's review of the first group quote (8 Nov 2026), on the owner's real Master data:
//   - the naturalists ticked on the day plan stay when the days are built again
//   - a price typed for a city hotel is not a route change (no new confirmation, no rebuilt days)
//   - the group sheet takes a typed hotel price per room, and says what each figure is made of
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "./chat";
import { buildDays, emptyPlan, planToTrip, routeKey, syncCityHotelPrices } from "./planner";
import { isConfirmed, markConfirmed } from "./confirm";
import { realCtx } from "./real-fixture";
import { quoteChecks } from "./checks";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { buildCostSheet } from "@/lib/sales/group/sheet";
import { defaultGroup, priceGroup, applyCells } from "@/lib/sales/group/costing";
import type { Plan } from "./types";

const T = "2026-11-08";
const MSG = "6 adults from usa, 3 rooms, arriving delhi 20 feb 2027, delhi 1 night at roseate house, fly to jabalpur, bandhavgarh 3 nights at kings lodge, drive to jabalpur and fly to delhi";
const base = markConfirmed(chatTurn(emptyPlan(T), initialFlags(emptyPlan(T)), MSG, realCtx, T).plan, T);
const safariDays = (p: Plan) => p.days.filter((d) => d.safaris.length);
const nats = (p: Plan) => p.days.flatMap((d) => d.safaris.map((s) => !!s.naturalist));

test("naturalists ticked by hand stay when the rooms (group size) or a meal plan change", () => {
  assert.ok(safariDays(base).length >= 2);
  assert.ok(nats(base).every((x) => !x), "no naturalist asked for");
  // tick every safari's naturalist on the day plan (as plan-step does)
  const ticked: Plan = { ...base, days: base.days.map((d) => ({ ...d, safaris: d.safaris.map((s) => ({ ...s, naturalist: true, by_hand: true })) })) };
  // the group grows: 4 rooms (a route change, the days are built again)
  const bigger: Plan = { ...ticked, guest: { ...ticked.guest, adults: 8, rooms: 4 } };
  assert.notEqual(routeKey(bigger), routeKey(ticked));
  const rebuilt = { ...bigger, days: buildDays(bigger, realCtx) };
  assert.deepEqual(nats(rebuilt), nats(ticked));
  assert.ok(nats(rebuilt).every(Boolean));
  // the day's words follow: "naturalist" is said on a safari day
  assert.ok(safariDays(rebuilt).some((d) => /naturalist/i.test(d.text)));
  // a jeep count set by hand stays too
  const jeeps: Plan = { ...ticked, days: ticked.days.map((d) => ({ ...d, safaris: d.safaris.map((s) => ({ ...s, jeeps: 3 })) })) };
  const r2 = buildDays({ ...jeeps, guest: { ...jeeps.guest, rooms: 5 } }, realCtx);
  assert.ok(r2.flatMap((d) => d.safaris).every((s) => s.jeeps === 3 && s.naturalist));
  // the priced trip charges the naturalists (one per safari)
  const res = priceTrip(planToTrip(rebuilt, T), realCtx.pricing);
  assert.equal(res.lines.filter((l) => l.kind === "safari" && l.group === "naturalist").length, nats(rebuilt).length);
});

test("a naturalist taken off by hand stays off, even when the guest asked for one on every safari", () => {
  const asked = markConfirmed(chatTurn(emptyPlan(T), initialFlags(emptyPlan(T)), MSG + " with naturalist on every safari", realCtx, T).plan, T);
  assert.ok(nats(asked).length > 0 && nats(asked).every(Boolean));
  const first = asked.days.findIndex((d) => d.safaris.length);
  const off: Plan = { ...asked, days: asked.days.map((d, i) => (i === first ? { ...d, safaris: d.safaris.map((s, k) => (k === 0 ? { ...s, naturalist: false, by_hand: true } : s)) } : d)) };
  const rebuilt = buildDays({ ...off, guest: { ...off.guest, rooms: 4 } }, realCtx);
  assert.equal(rebuilt[first].safaris[0].naturalist ?? false, false);
  assert.equal(rebuilt.flatMap((d) => d.safaris).filter((s) => !s.naturalist).length, 1);
  // not set by hand: the wish is applied as asked
  const plain = buildDays({ ...asked, guest: { ...asked.guest, rooms: 4 } }, realCtx);
  assert.ok(plain.flatMap((d) => d.safaris).every((s) => s.naturalist));
});

test("a price typed for Roseate House: the trip stays confirmed, the day plan keeps its choices, Next is open", () => {
  const ticked: Plan = { ...base, days: base.days.map((d) => ({ ...d, safaris: d.safaris.map((s) => ({ ...s, naturalist: true, by_hand: true })) })) };
  const typed: Plan = { ...ticked, city_stays: (ticked.city_stays ?? []).map((c) => ({ ...c, price: 23010 })) };
  assert.equal(routeKey(typed), routeKey(ticked));
  assert.ok(isConfirmed(typed), "still confirmed");
  const days = syncCityHotelPrices(typed, realCtx);
  const withPrice = { ...typed, days };
  // the hotel's line is on its night, the naturalists are where they were
  const hotel = days.flatMap((d) => d.items ?? []).filter((it) => it.auto?.startsWith("hotel:"));
  assert.equal(hotel.length, 1);
  assert.equal(hotel[0].price, 23010);
  assert.deepEqual(nats(withPrice), nats(ticked));
  const res = priceTrip(planToTrip(withPrice, T), realCtx.pricing);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(quoteChecks(withPrice, realCtx, res), []);
  // back to the Master rate: the line goes, still confirmed
  const back = { ...withPrice, city_stays: (withPrice.city_stays ?? []).map((c) => ({ ...c, price: null })) };
  assert.equal(syncCityHotelPrices(back, realCtx).flatMap((d) => d.items ?? []).filter((it) => it.auto?.startsWith("hotel:")).length, 0);
  assert.ok(isConfirmed(back));
});

test("a quote confirmed before 8 Nov (key with the typed price) is still confirmed", async () => {
  const { routeKeyWithPrices } = await import("./planner");
  const { sanitizePlan } = await import("./sanitize");
  const typed: Plan = { ...base, city_stays: (base.city_stays ?? []).map((c) => ({ ...c, price: 23010 })) };
  // the r2 key as it was made then
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(16).padStart(8, "0")}-${s.length}`;
  };
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const clean = sanitizePlan(JSON.parse(JSON.stringify(typed)))!;
  const old = `r2-${fnv(JSON.stringify(canon(JSON.parse(routeKeyWithPrices(clean)))))}`;
  assert.ok(isConfirmed({ ...typed, confirmed: { key: old, at: T } }));
  // ... and a change of the route after it still asks again
  assert.ok(!isConfirmed({ ...typed, guest: { ...typed.guest, rooms: 4 }, confirmed: { key: old, at: T } }));
});

test("group sheet: a typed Roseate price is a room's price for the night (not once for the group)", () => {
  const typed: Plan = { ...base, city_stays: (base.city_stays ?? []).map((c) => ({ ...c, price: 23010 })) };
  const p = { ...typed, days: syncCityHotelPrices(typed, realCtx) };
  const s = buildCostSheet(p, realCtx, T, { per_jeep: 2, per_vehicle: 3 });
  const d1 = s.days[0];
  assert.equal(d1.stay, "Roseate House");
  assert.equal(d1.city_hotel, true);
  assert.equal(d1.auto.single, 23010);
  assert.equal(d1.auto.double, 23010);
  assert.equal(d1.auto.group, 0);
  // the ladder: 6 + 1 pays 23,010 / 2 per guest for that night; the extra night is priced from it
  const g = { ...defaultGroup(), fx: 85, per_jeep: 2, per_vehicle: 3 };
  const pr = priceGroup(applyCells(s.days, {}), g);
  assert.equal(pr.extra_night?.name, "Roseate House");
  // Master rate after the SQL of 8 Nov: 19,500 + 18% = 23,010 a room, the same figure
  const viaMaster = buildCostSheet(base, { ...realCtx, pricing: { ...realCtx.pricing, roomRates: realCtx.pricing.roomRates.map((r) => (r.room_category_id === "R_roseate_house_ac_deluxe" && r.rate_double === 23000 ? { ...r, rate_double: 19500, rate_single: 19500 } : r)) } }, T, { per_jeep: 2, per_vehicle: 3 });
  assert.equal(viaMaster.days[0].auto.double, 23010);
  assert.equal(viaMaster.days[0].auto.single, 23010);
});

test("group sheet: each figure says what it is made of (two safaris and two naturalists in a jeep's day)", () => {
  const ticked: Plan = { ...base, days: base.days.map((d) => ({ ...d, safaris: d.safaris.map((s) => ({ ...s, naturalist: true, by_hand: true })) })) };
  const s = buildCostSheet(ticked, realCtx, T, { per_jeep: 2, per_vehicle: 3 });
  const full = s.days.find((d) => (d.why?.jeep ?? "").startsWith("2 safaris"));
  assert.ok(full, JSON.stringify(s.days.map((d) => d.why)));
  assert.equal(full!.why!.jeep, "2 safaris, 2 naturalists");
  assert.match(s.days[0].why?.double ?? "", /room/);
});
