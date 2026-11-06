// Run with:  npx tsx --test lib/redpanda/mixed-trip.test.ts
// Red Panda Outpost inside a Sales trip (owner, 6 Nov 2026): foreign guests land in Delhi, fly to
// Bagdogra for Red Panda, and may add Kaziranga or our Central India lodges. Run on the owner's REAL
// Master data (real-fixture.ts) plus the rows supabase/red_panda_in_sales.sql adds, through the Sales
// reader, route, planner and pricing engine, with the Red Panda tariff of supabase/red_panda.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatTurn, initialFlags, type ChatFlags } from "@/lib/sales/plan/chat";
import { emptyPlan, planToTrip } from "@/lib/sales/plan/planner";
import { markConfirmed } from "@/lib/sales/plan/confirm";
import { priceTrip } from "@/lib/sales/pricing/engine";
import { realCtx } from "@/lib/sales/plan/real-fixture";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";
import type { RpSalesPricing } from "./in-sales";
import type { Market } from "./types";

const TODAY = "2026-11-06";
const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "red_panda_in_sales.sql"), "utf8");
const block = (kind: string) => {
  const m = new RegExp(`\\('${kind}', '([^']*)',\\s*'((?:[^']|'')*)'\\)`).exec(SQL);
  return m ? { title: m[1], body: m[2].replace(/''/g, "'") } : null;
};

// the Red Panda tariff as supabase/red_panda.sql seeds it (2026-27)
const Y26: [number, number, number, number][] = [
  [1, 395000, 455000, 423000], [2, 220000, 253000, 235000], [3, 200000, 230000, 214000], [4, 182000, 210000, 195000], [5, 176000, 203000, 188000],
  [6, 160000, 185000, 171000], [7, 170000, 195000, 182000], [8, 154000, 177000, 165000], [9, 154000, 177000, 165000], [10, 154000, 177000, 165000],
];
const MKT: Market[] = ["b2b", "foreign", "indian"];
const RP: RpSalesPricing = {
  tariff: Y26.flatMap(([guests, ...r]) => MKT.map((market, i) => ({ season: "2026-27", valid_from: "2026-10-01", valid_to: "2027-05-31", market, guests, per_pax: r[i], active: true }))),
  supplements: MKT.flatMap((market, i) => [
    { season: "2026-27", valid_from: "2026-10-01", valid_to: "2027-05-31", market, kind: "single_room" as const, amount: [60000, 70000, 65000][i], active: true },
    { season: "2026-27", valid_from: "2026-10-01", valid_to: "2027-05-31", market, kind: "tour_leader" as const, amount: [45000, 52000, 48000][i], active: true },
  ]),
  gst_pct: 5,
  package_nights: 5,
  min_nights: 4,
  max_guests: 10,
  min_age: 16,
  closed_months: [6, 7, 8, 9],
};

// the rows supabase/red_panda_in_sales.sql adds to Sales Master data
function withOutpost(base: BuilderContext, redPanda: RpSalesPricing | null): BuilderContext {
  const c = JSON.parse(JSON.stringify(base)) as BuilderContext;
  const loc = (name: string) => c.locations.find((l) => l.name === name || c.properties.find((p) => p.id === l.property_id)?.name === name)!.id;
  c.pricing.parks.push({ id: "P_singalila", name: "Singalila National Park" });
  const prop = { id: "H_red_panda_outpost", name: "Red Panda Outpost", park_id: "P_singalila", kind: "own_lodge" };
  c.pricing.properties.push(prop);
  c.properties.push({ ...prop, fallback_priority: 100, sort: 0 } as unknown as BuilderContext["properties"][number]);
  c.locations.push({ id: "L_red_panda_outpost", name: "Red Panda Outpost", type: "property", property_id: prop.id, code: null } as unknown as BuilderContext["locations"][number]);
  c.locations.push({ id: "L_bhadrapur_airport", name: "Bhadrapur Airport", type: "airport", property_id: null, code: "BDP" } as unknown as BuilderContext["locations"][number]);
  c.pricing.locations.push({ id: "L_red_panda_outpost", name: "Red Panda Outpost", property_id: prop.id }, { id: "L_bhadrapur_airport", name: "Bhadrapur Airport", property_id: null } as never);
  c.pricing.rooms.push({ id: "R_rpo_twin", property_id: prop.id, name: "Twin room", max_adults: 2, max_children: 1, extra_bed: false });
  c.rooms.push({ id: "R_rpo_twin", property_id: prop.id, name: "Twin room", sort: 0 });
  const road = (from: string, hours: number, id: string) =>
    c.pricing.transferRates.push({ id, from_location_id: loc(from), to_location_id: "L_red_panda_outpost", vehicle_type: "4x4 Bolero (in the Red Panda package)", capacity: 3, rate: 0, drive_hours: hours, night_surcharge: 0, bidirectional: true, tax_pct: 0, active: true, valid_from: null, valid_to: null } as never);
  road("Bagdogra Airport", 5, "T_rp_ixb");
  road("Bhadrapur Airport", 3.5, "T_rp_bdp");
  road("Mayfair Chumta", 5, "T_rp_mayfair");
  for (const kind of ["day_arrival", "day_transfer", "day_leisure", "day_departure"]) {
    const b = block(kind)!;
    c.templates.push({ kind, title: b.title, body: b.body, park_id: null, property_id: prop.id, is_default: false });
  }
  c.readerRules = [...(c.readerRules ?? []), { phrase: "redpanda", meaning: "Red Panda Outpost" }];
  c.pricing.redPanda = redPanda;
  return c;
}
const CTX = withOutpost(realCtx, RP);

function read(ctx: BuilderContext, ...msgs: string[]) {
  let plan: Plan = emptyPlan(TODAY);
  let flags: ChatFlags = initialFlags(plan);
  for (const m of msgs) {
    const r = chatTurn(plan, flags, m, ctx, TODAY);
    plan = r.plan;
    flags = r.flags;
  }
  return plan;
}
const nameOf = (ctx: BuilderContext, id: string | null) => ctx.properties.find((p) => p.id === id)?.name ?? ctx.locations.find((l) => l.id === id)?.name ?? String(id);
const price = (p: Plan, ctx = CTX) => priceTrip(planToTrip(markConfirmed(p, TODAY), TODAY), ctx.pricing);
const rpLines = (r: ReturnType<typeof price>) => r.lines.filter((l) => l.property_id === "H_red_panda_outpost" && l.kind === "room");

const DELHI_RP_KAZ =
  "2 adults from UK, 1 room, arriving delhi on 10 feb 2027, delhi 1 night at roseate house, then fly to bagdogra for red panda outpost 5 nights, then fly bagdogra to guwahati, kaziranga 3 nights at iora retreat, then fly back to delhi";

test("Delhi - Red Panda - Kaziranga: the route, the flights, the days, no jeep safaris at Singalila", () => {
  const P = read(CTX, DELHI_RP_KAZ);
  if (process.env.DBG) for (const d of P.days) console.log("DAY", d.date, d.kind, nameOf(CTX, d.property_id), "|", d.title, "|", d.transfer ? `${nameOf(CTX, d.transfer.from_location_id)}>${nameOf(CTX, d.transfer.to_location_id)}` : "", (d.city_transfers ?? []).map((t) => `${t.from_label}>${t.to_label}`).join(","), "|", d.items.map((i) => i.title).join(","), "|", d.text.slice(0, 140));
  assert.deepEqual(P.stops.map((s) => `${nameOf(CTX, s.property_id)} ${s.nights}`), ["Red Panda Outpost 5", "Iora Retreat 3"]);
  assert.deepEqual(P.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Bagdogra", "Bagdogra>Guwahati", "Guwahati>Delhi"]);
  const rp = P.days.filter((d) => d.property_id === "H_red_panda_outpost");
  assert.equal(rp.length, 5);
  assert.deepEqual(rp.flatMap((d) => d.safaris), []);
  // in: Bagdogra Airport to the Outpost (in the package); a day there is the tracking day
  assert.ok(P.days.some((d) => d.transfer && nameOf(CTX, d.transfer.from_location_id) === "Bagdogra Airport" && nameOf(CTX, d.transfer.to_location_id) === "Red Panda Outpost"));
  assert.ok(rp.slice(1).every((d) => d.title === "In search of the red panda / birding"), rp.map((d) => d.title).join(" | "));
  assert.match(rp[0].text, /Jaubari village/);
  assert.deepEqual(P.days.flatMap((d) => d.notes.filter((n) => /^No road between/.test(n))), []);
  // leaving the Outpost and flying to Guwahati the same day: the day says to book a late flight
  assert.ok(P.days.find((d) => d.date === "2027-02-16")!.notes.some((n) => /after 5 PM/.test(n)));
  assert.ok(!P.days.find((d) => d.date === "2027-02-11")!.notes.some((n) => /after 5 PM/.test(n)));
});

test("its price: the Red Panda tariff per night (B2C foreign, 2 guests) + 5% GST; the rest from Master data", () => {
  const r = price(read(CTX, DELHI_RP_KAZ));
  assert.deepEqual(r.errors, []);
  const nights = rpLines(r);
  assert.equal(nights.length, 5);
  assert.ok(nights.every((l) => l.amount === 106260 && l.tax === 5060 && l.tax_pct === 5), JSON.stringify(nights[0]));
  assert.equal(nights.reduce((t, l) => t + l.amount, 0), 531300); // = the Red Panda quote for 2 foreign guests, 5 nights
  assert.match(nights[0].description, /^Red Panda Outpost, Twin room, package \(B2C foreign 2026-27\)/);
  // the transfer in the package: Rs 0, never a "price needed"
  assert.ok(!r.missing.some((m) => /red panda/i.test(m.label)));
  // Iora Retreat and Roseate House are priced from their own rates as before
  assert.ok(r.lines.some((l) => l.property_id && nameOf(CTX, l.property_id) === "Iora Retreat" && l.kind === "room" && l.amount > 0));
  assert.ok(r.lines.some((l) => l.property_id && nameOf(CTX, l.property_id) === "Roseate House" && l.amount > 0));
});

test("market: a travel agent = B2B; Indian guests = B2C Indian; 3 guests in 2 rooms; 4 nights pro rata", () => {
  const P = read(CTX, DELHI_RP_KAZ);
  const agent = price({ ...P, guest: { ...P.guest, source: "Travel agent", agent_name: "Wild Nature Travels" } });
  assert.equal(rpLines(agent)[0].amount - rpLines(agent)[0].tax, 88000); // 2,20,000 x 2 / 5
  const indian = price({ ...P, guest: { ...P.guest, country: "IN", nationality: "indian" } });
  assert.equal(rpLines(indian)[0].amount - rpLines(indian)[0].tax, 94000); // 2,35,000 x 2 / 5
  const three = read(CTX, DELHI_RP_KAZ.replace("2 adults", "3 adults").replace("1 room", "2 rooms"));
  assert.equal(rpLines(price(three))[0].amount - rpLines(price(three))[0].tax, 138000); // 2,30,000 x 3 / 5
  const four = read(CTX, DELHI_RP_KAZ.replace("red panda outpost 5 nights", "red panda outpost 4 nights"));
  const r4 = price(four);
  assert.equal(rpLines(r4).length, 4);
  assert.equal(rpLines(r4).reduce((t, l) => t + l.amount - l.tax, 0), 404800); // 4/5 of 5,06,000
  assert.ok(r4.warnings.some((w) => /pro rata/.test(w)));
});

test("rules: a child under 16, the monsoon, 3 nights, no Red Panda access: errors, never a price", () => {
  const P = read(CTX, DELHI_RP_KAZ);
  assert.match(price({ ...P, guest: { ...P.guest, children: [10] } }).errors.join(), /from 16 years: the child of 10/);
  const july = read(CTX, DELHI_RP_KAZ.replace("10 feb 2027", "10 jul 2027"));
  assert.match(price(july).errors.join(), /closed June to September/);
  const three = read(CTX, DELHI_RP_KAZ.replace("red panda outpost 5 nights", "red panda outpost 3 nights"));
  assert.match(price(three).errors.join(), /at least 4 nights/);
  const noAccess = withOutpost(realCtx, null);
  const r = price(read(noAccess, DELHI_RP_KAZ), noAccess);
  assert.match(r.errors.join(), /only people with Red Panda access/);
  assert.equal(rpLines(r).length, 0);
});

test("discounts as at our lodges: % off our lodges' rooms and on the whole trip include Red Panda; markup too", () => {
  const P = read(CTX, DELHI_RP_KAZ);
  const base = price(P);
  const lodges = price({ ...P, discount: { pct: 10, scope: "lodges", reason: "test" } });
  const rpBase = rpLines(base).reduce((t, l) => t + l.amount, 0);
  const off = base.totals.grand - lodges.totals.grand;
  // 10% of our own lodges' rooms: Red Panda Outpost is one of them (Iora and Roseate are not)
  assert.equal(off, Math.round(rpBase * 0.1));
  const all = price({ ...P, discount: { pct: 10, scope: "all", reason: "test" } });
  assert.ok(base.totals.grand - all.totals.grand > off);
  const markup = price({ ...P, markup_pct: 10 });
  assert.ok(markup.totals.grand > base.totals.grand);
});

test("only Red Panda: Bagdogra in and out, the Sales payment schedule; Siliguri night before through Mayfair", () => {
  const P = read(CTX, "2 adults from germany, arriving bagdogra 12 feb 2027, 1 night at mayfair chumta, then red panda outpost 5 nights, fly out from bagdogra");
  assert.deepEqual(P.stops.map((s) => `${nameOf(CTX, s.property_id)} ${s.nights}`), ["Red Panda Outpost 5"]);
  const r = price(P);
  if (process.env.DBG) console.log(JSON.stringify(P.days.map((d) => [d.date, d.kind, nameOf(CTX, d.property_id), d.transfer && `${nameOf(CTX, d.transfer.from_location_id)}>${nameOf(CTX, d.transfer.to_location_id)}`, (d.city_transfers ?? []).map((t) => `${t.from_label}>${t.to_label}`), d.title])), JSON.stringify(P.city_stays), JSON.stringify(P.flights));
  assert.deepEqual(r.errors, []);
  assert.equal(rpLines(r).reduce((t, l) => t + l.amount, 0), 531300);
  assert.ok(P.days.some((d) => d.transfer && nameOf(CTX, d.transfer.from_location_id) === "Mayfair Chumta" && nameOf(CTX, d.transfer.to_location_id) === "Red Panda Outpost"));
  assert.ok(r.payments.length >= 1);
  assert.equal(r.payments.reduce((t, p) => t + p.amount, 0), r.totals.grand);
});

test("Kaziranga first, then Red Panda, then Delhi", () => {
  const P = read(CTX, "2 adults from france, arriving delhi 5 mar 2027, fly to jorhat, kaziranga 3 nights at iora retreat, then fly guwahati to bagdogra, red panda outpost 5 nights, then fly bagdogra to delhi, delhi 1 night at roseate house");
  assert.deepEqual(P.stops.map((s) => `${nameOf(CTX, s.property_id)} ${s.nights}`), ["Iora Retreat 3", "Red Panda Outpost 5"]);
  assert.deepEqual(P.flights?.map((f) => `${f.from}>${f.to}`), ["Delhi>Jorhat", "Guwahati>Bagdogra", "Bagdogra>Delhi"]);
  const r = price(P);
  assert.deepEqual(r.errors, []);
  assert.equal(rpLines(r).reduce((t, l) => t + l.amount, 0), 531300);
  assert.deepEqual(P.days.flatMap((d) => d.notes.filter((n) => /^No road between/.test(n))), []);
});

test("Red Panda with our Central India lodges: Delhi, Red Panda, Delhi, Tadoba", () => {
  const P = read(CTX, "2 adults from usa, arriving delhi 10 jan 2027, 1 night delhi at roseate house, fly to bagdogra, red panda outpost 5 nights, fly bagdogra to delhi, then fly delhi to nagpur, tadoba 3 nights at waghoba eco lodge, nagpur drop");
  assert.deepEqual(P.stops.map((s) => `${nameOf(CTX, s.property_id)} ${s.nights}`), ["Red Panda Outpost 5", "Waghoba Eco Lodge 3"]);
  const r = price(P);
  assert.deepEqual(r.errors, []);
  assert.equal(rpLines(r).length, 5);
  // jeep safaris at Tadoba, none at Singalila
  assert.ok(P.days.filter((d) => nameOf(CTX, d.property_id) === "Waghoba Eco Lodge").some((d) => d.safaris.length > 0));
  // a multi-lodge offer counts the Outpost's nights like our other lodges
  assert.ok(r.lines.filter((l) => l.kind === "room" && l.property_id === "H_red_panda_outpost").length === 5);
});

test("Bhadrapur in and out (Nepal side), and dates not fixed", () => {
  const P = read(CTX, "2 adults from germany, arriving bhadrapur 12 feb 2027, red panda outpost 5 nights, bhadrapur drop");
  assert.deepEqual(P.stops.map((s) => `${nameOf(CTX, s.property_id)} ${s.nights}`), ["Red Panda Outpost 5"]);
  assert.ok(P.days.some((d) => d.transfer && nameOf(CTX, d.transfer.from_location_id) === "Bhadrapur Airport"));
  assert.equal(rpLines(price(P)).reduce((t, l) => t + l.amount, 0), 531300);
  const dl = price({ ...P, dateless: true, rate_basis: { season: "high", safari_days: "weekday", year: "this" } as never });
  assert.equal(rpLines(dl).reduce((t, l) => t + l.amount, 0), 531300);
});

test("the reader: 'red panda', 'redpanda', 'singalila' with nights; written the way sales writes", () => {
  for (const msg of [
    "2 pax uk, delhi 1n, fly bagdogra, red panda 5 nights, 12 feb 27",
    "2 adults from uk arriving bagdogra 12 feb 2027, redpanda 5n",
    "couple from uk, singalila 5 nights from 12 feb 2027 via bagdogra",
  ]) {
    const P = read(CTX, msg);
    assert.ok(P.stops.some((s) => s.property_id === "H_red_panda_outpost" && s.nights === 5), `${msg}: ${P.stops.map((s) => `${nameOf(CTX, s.property_id)} ${s.nights}`).join(", ")}`);
  }
});
