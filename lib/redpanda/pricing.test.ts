// Run with:  npx tsx --test lib/redpanda/pricing.test.ts
// Red Panda prices, exact, for every market and group size of Red_Panda_Tariff_Sheet.xlsx (both
// years), the supplements, the tour leader, pro rata nights, the Mayfair hotel and its transfer,
// GST, markup, discount, adjustment and the 50 / 50 payment terms. The settings are the ones the
// SQL seeds (read from supabase/red_panda.sql).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guestBreakup, priceRedPanda } from "./pricing";
import { emptyRpPlan, readSettings, sanitizeRpPlan } from "./plan";
import type { Market, RpMaster, RpPlan, RpSupplementRow, RpTariffRow } from "./types";

const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "red_panda.sql"), "utf8");
const SETTINGS = readSettings(JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(SQL)![1]));

// the sheet, per person for 5 nights: [guests, B2B, B2C foreign, B2C Indian]
const Y25: [number, number, number, number][] = [
  [1, 360000, 414000, 385000], [2, 200000, 230000, 214000], [3, 180000, 207000, 192500], [4, 165000, 190000, 176500], [5, 160000, 184000, 171500],
  [6, 145000, 167000, 155500], [7, 155000, 178000, 166000], [8, 140000, 161000, 150000], [9, 140000, 161000, 150000], [10, 140000, 161000, 150000],
];
const Y26: [number, number, number, number][] = [
  [1, 395000, 455000, 423000], [2, 220000, 253000, 235000], [3, 200000, 230000, 214000], [4, 182000, 210000, 195000], [5, 176000, 203000, 188000],
  [6, 160000, 185000, 171000], [7, 170000, 195000, 182000], [8, 154000, 177000, 165000], [9, 154000, 177000, 165000], [10, 154000, 177000, 165000],
];
const MKT: Market[] = ["b2b", "foreign", "indian"];
const tariffRows = (season: string, f: string, t: string, rows: typeof Y25): RpTariffRow[] =>
  rows.flatMap(([guests, ...r]) => MKT.map((market, i) => ({ season, valid_from: f, valid_to: t, market, guests, per_pax: r[i], active: true })));
const supRows = (season: string, f: string, t: string, single: number[], leader: number[]): RpSupplementRow[] =>
  MKT.flatMap((market, i) => [
    { season, valid_from: f, valid_to: t, market, kind: "single_room" as const, amount: single[i], active: true },
    { season, valid_from: f, valid_to: t, market, kind: "tour_leader" as const, amount: leader[i], active: true },
  ]);

const MASTER: RpMaster = {
  tariff: [...tariffRows("2025-26", "2025-10-01", "2026-05-31", Y25), ...tariffRows("2026-27", "2026-10-01", "2027-05-31", Y26)],
  supplements: [...supRows("2025-26", "2025-10-01", "2026-05-31", [55000, 65000, 59000], [40000, 46000, 43000]), ...supRows("2026-27", "2026-10-01", "2027-05-31", [60000, 70000, 65000], [45000, 52000, 48000])],
  settings: SETTINGS,
  hotel: {
    property_id: "H_mayfair",
    name: "Mayfair Chumta",
    rooms: [
      { id: "R_jungle", name: "Jungle View Room", rates: [{ valid_from: "2026-10-01", valid_to: "2027-05-31", meal_plan: "AP", rate_single: 15500, rate_double: 17000, tax_pct: 18, rates_include_tax: false }] },
      { id: "R_mountain", name: "Mountain View Room", rates: [{ valid_from: "2026-10-01", valid_to: "2027-05-31", meal_plan: "AP", rate_single: 16500, rate_double: 18000, tax_pct: 18, rates_include_tax: false }] },
    ],
    transfer: { rate: 3000, tax_pct: 5, capacity: 6, vehicle_type: "Innova / Crysta", valid_from: null, valid_to: "2027-09-30" },
  },
};

const plan = (o: Partial<RpPlan> & { g?: Partial<RpPlan["guest"]> } = {}): RpPlan => {
  const p = emptyRpPlan();
  const { g, ...rest } = o;
  return { ...p, arrival: "2026-11-20", ...rest, guest: { ...p.guest, ...g } };
};
const marketPlan = (m: Market, adults: number, arrival: string) =>
  plan({ arrival, g: { adults, booked_by: m === "b2b" ? "agent" : "direct", nationality: m === "indian" ? "indian" : "foreign" } });

test("the settings the SQL seeds: GST 5%, 5-night package, 4 to 10 nights, 16+, 2 airports, 50/50 at 45 days", () => {
  assert.equal(SETTINGS.gst_pct, 5);
  assert.equal(SETTINGS.package_nights, 5);
  assert.equal(SETTINGS.min_nights, 4);
  assert.equal(SETTINGS.min_age, 16);
  assert.deepEqual(SETTINGS.airports.map((a) => [a.code, a.hours]), [["IXB", 5], ["BDP", 3.5]]);
  assert.deepEqual([SETTINGS.deposit_pct, SETTINGS.balance_days_before], [50, 45]);
  assert.deepEqual(SETTINGS.closed_months, [6, 7, 8, 9]);
  // the brief's good-to-know lines are there
  const gtk = SETTINGS.good_to_know.join(" ");
  for (const w of ["immigration formalities at both ends", "Nepal visa", "local representative", "about an hour at each end", "5 hours", "no metalled roads", "4x4 Boleros", "not from the jeep", "moderate level of fitness", "9,400 ft", "three community forests, 45 minutes to 1 hour 15 minutes", "15 - 30 minutes in dense forest", "trek after breakfast and be driven back", "3 - 4 hours"])
    assert.ok(gtk.includes(w), w);
});

test("every market x group size x year: per person x guests, + 5% GST, exact", () => {
  for (const [year, rows, arrival] of [["2025-26", Y25, "2026-03-10"], ["2026-27", Y26, "2026-11-20"]] as const) {
    for (const [guests, ...rates] of rows) {
      MKT.forEach((m, i) => {
        const p = priceRedPanda(marketPlan(m, guests, arrival), MASTER);
        assert.deepEqual(p.errors, [], `${year} ${m} ${guests}`);
        assert.equal(p.market, m);
        assert.equal(p.season, year);
        assert.equal(p.per_pax, rates[i]);
        const pkg = rates[i] * guests;
        assert.equal(p.totals.package, pkg, `${year} ${m} ${guests}`);
        assert.equal(p.totals.package_gst, Math.round(pkg * 0.05));
        assert.equal(p.totals.grand, pkg + Math.round(pkg * 0.05));
        assert.equal(p.rooms, Math.ceil(guests / 2));
        assert.equal(p.singles, guests % 2);
      });
    }
  }
});

test("worked examples: 2 foreign guests 2026-27 = 5,06,000 + 25,300 = 5,31,300; solo Indian 2025-26 = 4,04,250", () => {
  const two = priceRedPanda(marketPlan("foreign", 2, "2026-12-01"), MASTER);
  assert.deepEqual([two.totals.package, two.totals.package_gst, two.totals.grand, two.perPerson], [506000, 25300, 531300, 265650]);
  const solo = priceRedPanda(marketPlan("indian", 1, "2026-04-01"), MASTER);
  assert.equal(solo.totals.grand, 404250);
  // the payment terms: 50% at booking, the balance 45 days before arrival
  assert.deepEqual(two.payments.map((x) => [x.label, x.due, x.amount]), [["Deposit", null, 265650], ["Balance", "2026-10-17", 265650]]);
});

test("an agent is B2B whatever the nationality; a direct guest is foreign or Indian", () => {
  assert.equal(priceRedPanda(plan({ g: { booked_by: "agent", nationality: "indian", adults: 2 } }), MASTER).per_pax, 220000);
  assert.equal(priceRedPanda(plan({ g: { booked_by: "direct", nationality: "indian", adults: 2 } }), MASTER).per_pax, 235000);
  assert.equal(priceRedPanda(plan({ g: { booked_by: "direct", nationality: "foreign", adults: 2 } }), MASTER).per_pax, 253000);
});

test("guests of 16+ count at the full tariff; younger is refused", () => {
  const p = priceRedPanda(plan({ g: { adults: 2, child_ages: [16, 17] } }), MASTER);
  assert.equal(p.guests, 4);
  assert.equal(p.totals.package, 4 * 210000);
  const young = priceRedPanda(plan({ g: { adults: 2, child_ages: [12] } }), MASTER);
  assert.equal(young.ok, false);
  assert.match(young.errors.join(), /16 years or older/);
});

test("rooms: a room more than the standard = a single room supplement; too few or too many refused", () => {
  const p = priceRedPanda(plan({ g: { adults: 2, rooms: 2 } }), MASTER); // foreign 2026-27
  assert.deepEqual([p.rooms, p.singles], [2, 2]);
  assert.equal(p.totals.package, 506000 + 70000);
  assert.equal(p.totals.grand, 576000 + 28800);
  assert.match(priceRedPanda(plan({ g: { adults: 4, rooms: 1 } }), MASTER).errors.join(), /at least 2 rooms/);
  assert.match(priceRedPanda(plan({ g: { adults: 10, rooms: 6 } }), MASTER).errors.join(), /At most 5 rooms/);
  assert.match(priceRedPanda(plan({ g: { adults: 11 } }), MASTER).errors.join(), /up to 10 guests/);
  // B2B 2025-26: 3 guests in 3 rooms = 1 room more than the standard 2 = 1 supplement of 55,000
  const b = priceRedPanda(plan({ arrival: "2026-02-01", g: { adults: 3, rooms: 3, booked_by: "agent" } }), MASTER);
  assert.equal(b.totals.package, 3 * 180000 + 55000);
});

test("tour leader: charged up to 3 paying guests, complimentary from 4", () => {
  const three = priceRedPanda(plan({ tour_leader: true, g: { adults: 3, nationality: "indian" } }), MASTER);
  assert.equal(three.totals.package, 3 * 214000 + 48000);
  const four = priceRedPanda(plan({ tour_leader: true, g: { adults: 4, nationality: "indian" } }), MASTER);
  assert.equal(four.totals.package, 4 * 195000);
  assert.equal(four.lines.find((l) => l.key === "tour_leader")?.detail, "Complimentary from 4 paying guests");
});

test("nights: 4 = 4/5 of the package (with a warning), 6 and 7 pro rata, fewer than 4 refused", () => {
  const four = priceRedPanda(plan({ nights: 4, g: { adults: 2 } }), MASTER);
  assert.equal(four.ok, true);
  assert.equal(four.totals.package, 404800); // 5,06,000 x 4/5
  assert.match(four.warnings.join(), /pro rata/);
  assert.equal(priceRedPanda(plan({ nights: 6, g: { adults: 2 } }), MASTER).totals.package, 607200);
  assert.equal(priceRedPanda(plan({ nights: 7, g: { adults: 3, nationality: "indian" } }), MASTER).totals.package, 898800); // 214000 x 3 x 7/5
  // the supplement and the tour leader are pro rata too
  const six = priceRedPanda(plan({ nights: 6, tour_leader: true, g: { adults: 1, rooms: 1 } }), MASTER);
  assert.equal(six.totals.package, 546000 + 62400);
  assert.match(priceRedPanda(plan({ nights: 3 }), MASTER).errors.join(), /At least 4 nights/);
  assert.match(priceRedPanda(plan({ nights: 11 }), MASTER).errors.join(), /At most 10 nights/);
});

test("closed June to September; a stay running into June is refused; no tariff yet = an error", () => {
  assert.match(priceRedPanda(plan({ arrival: "2027-07-10" }), MASTER).errors.join(), /closed in July/);
  assert.match(priceRedPanda(plan({ arrival: "2027-05-29" }), MASTER).errors.join(), /closed in June/);
  assert.match(priceRedPanda(plan({ arrival: "2027-11-10" }), MASTER).errors.join(), /No Red Panda tariff/);
  assert.match(priceRedPanda(plan({ arrival: null }), MASTER).errors.join(), /arrival date/);
  // the last night on 31 May is fine
  assert.equal(priceRedPanda(plan({ arrival: "2027-05-26", g: { adults: 2 } }), MASTER).ok, true);
});

test("a rate typed by hand replaces the tariff (with a warning); a negative one is refused", () => {
  const p = priceRedPanda(plan({ per_pax_override: 240000, g: { adults: 2 } }), MASTER);
  assert.equal(p.totals.package, 480000);
  assert.match(p.warnings.join(), /typed by hand/);
  assert.equal(priceRedPanda(plan({ per_pax_override: -1 }), MASTER).ok, false);
});

test("markup and discount before GST, adjustment after; the reason is required", () => {
  const p = priceRedPanda(plan({ markup_pct: 10, discount: 6000, adjustment: { amount: -300, reason: "Round off" }, g: { adults: 2 } }), MASTER);
  // 5,06,000 + 50,600 - 6,000 = 5,50,600; GST 27,530; - 300
  assert.deepEqual([p.totals.markup, p.totals.discount, p.totals.package_gst, p.totals.grand], [50600, 6000, 27530, 577830]);
  assert.match(priceRedPanda(plan({ adjustment: { amount: 500, reason: "" } }), MASTER).errors.join(), /reason for the adjustment/);
  assert.equal(priceRedPanda(plan({ discount: -5 }), MASTER).ok, false);
  // the guest breakup adds up to the total and shows no markup, discount or adjustment line
  const b = guestBreakup(p);
  assert.equal(b.reduce((t, x) => t + x.amount, 0), p.totals.grand);
  assert.ok(!b.some((x) => /markup|discount|adjust|round/i.test(x.label)));
});

test("Mayfair before and after (Bagdogra): rooms x nights + 18%, the airport transfer Rs 3,000 + 5% per car", () => {
  const p = priceRedPanda(
    plan({ arrival: "2026-11-19", hotel_before: { nights: 1, room_id: "R_jungle" }, hotel_after: { nights: 2, room_id: "R_mountain" }, g: { adults: 3 } }),
    MASTER,
  );
  assert.deepEqual(p.errors, []);
  // 3 guests = 1 double + 1 single: Jungle 17,000 + 15,500 = 32,500 x 1 night + 18% = 38,350
  // Mountain 18,000 + 16,500 = 34,500 x 2 nights = 69,000 + 18% = 81,420; transfers 3,150 each
  assert.equal(p.totals.hotel, 38350 + 3150 + 81420 + 3150);
  assert.deepEqual([p.arrival, p.outpost.check_in, p.outpost.check_out, p.departure], ["2026-11-19", "2026-11-20", "2026-11-25", "2026-11-27"]);
  assert.equal(p.totals.grand, 3 * 230000 * 1.05 + 126070);
  // 7 guests = 2 cars
  const seven = priceRedPanda(plan({ hotel_before: { nights: 1, room_id: "R_jungle" }, g: { adults: 7 } }), MASTER);
  assert.equal(seven.lines.find((l) => l.key === "hotel_before_transfer")?.amount, 6000);
  // through Bhadrapur there is no Mayfair; no room chosen = an error
  assert.match(priceRedPanda(plan({ arrive_airport: "BDP", hotel_before: { nights: 1, room_id: "R_jungle" } }), MASTER).errors.join(), /near Bagdogra/);
  assert.match(priceRedPanda(plan({ hotel_after: { nights: 1, room_id: null } }), MASTER).errors.join(), /choose the room type/);
  assert.match(priceRedPanda(plan({ hotel_before: { nights: 1, room_id: "R_jungle" } }), { ...MASTER, hotel: null }).errors.join(), /no partner hotel/);
  // a night with no hotel rate is an error, never 0
  assert.match(priceRedPanda(plan({ arrival: "2027-05-31", nights: 4, hotel_before: { nights: 1, room_id: "R_jungle" } }), MASTER).errors.join(), /closed|no rate/);
});

test("extra items typed by hand with their GST", () => {
  const p = priceRedPanda(plan({ custom_items: [{ label: "Darjeeling day", amount: 10000, gst_pct: 5 }], g: { adults: 2 } }), MASTER);
  assert.equal(p.totals.extras, 10500);
  assert.equal(p.totals.grand, 531300 + 10500);
  assert.equal(priceRedPanda(plan({ custom_items: [{ label: "x", amount: -1, gst_pct: 0 }] }), MASTER).ok, false);
});

test("the plan from the browser is checked: text, numbers, airports, dates", () => {
  const p = sanitizeRpPlan({ kind: "evil", guest: { name: "  Ann \u0007", adults: "3", child_ages: ["17", -4], rooms: "", nationality: "martian", booked_by: "agent" }, arrival: "2026-13-40", nights: "99", arrive_airport: "XXX", markup_pct: "5", custom_items: [{ label: "x".repeat(500), amount: "abc" }] });
  assert.equal(p.kind, "red_panda");
  assert.equal(p.guest.name, "Ann");
  assert.deepEqual([p.guest.adults, p.guest.child_ages, p.guest.rooms, p.guest.nationality, p.guest.booked_by], [3, [17, 0], null, "foreign", "agent"]);
  assert.equal(p.arrival, null);
  assert.equal(p.nights, 30);
  assert.equal(p.arrive_airport, "IXB");
  assert.equal(p.custom_items[0].label.length, 120);
  assert.equal(p.custom_items[0].amount, 0);
});

// Delhi (owner, 6 Nov 2026): the real Sales Master data rows (Roseate House CP Rs 23,000 + 18% to
// 31 Mar 2027; Delhi Airport (IGI) - Roseate House Innova Rs 3,000 + 5%; Delhi - Bagdogra Rs 15,000)
const ROSEATE = {
  property_id: "H_roseate",
  name: "Roseate House",
  rooms: [{ id: "R_roseate", name: "AC Deluxe", rates: [
    { valid_from: "2026-10-01", valid_to: "2027-03-31", meal_plan: "CP", rate_single: 23000, rate_double: 23000, tax_pct: 18, rates_include_tax: false },
    { valid_from: "2027-04-01", valid_to: "2027-09-30", meal_plan: "CP", rate_single: 17000, rate_double: 17000, tax_pct: 18, rates_include_tax: false },
  ] }],
  transfer: { rate: 3000, tax_pct: 5, capacity: 6, vehicle_type: "Innova / Crysta", valid_from: null, valid_to: "2027-09-30" },
};
const FLIGHT = (from: string, to: string) => ({ from, to, fare: 15000, airline: "IndiGo", flight_no: "", depart: "", arrive: "" });
const WITH_DELHI: RpMaster = { ...MASTER, delhi: { hotels: [ROSEATE], out: FLIGHT("Delhi", "Bagdogra"), back: FLIGHT("Bagdogra", "Delhi") } };
const delhi = (nights: number) => ({ flight: true, nights, hotel_id: nights ? "H_roseate" : null, room_id: nights ? "R_roseate" : null });

test("Delhi 1 night - Red Panda 5 nights - Delhi 1 night: every line from Master data, exact", () => {
  const p = priceRedPanda(plan({ arrival: "2027-02-10", delhi_before: delhi(1), delhi_after: delhi(1), g: { adults: 2 } }), WITH_DELHI);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.lines.map((l) => [l.key, l.amount + l.gst]), [
    ["package", 531300],
    ["delhi_before", 27140], // 23,000 + 18%
    ["delhi_before_transfer", 3150], // IGI to the hotel
    ["delhi_before_transfer_1", 3150], // the hotel to IGI
    ["flight_out", 30000], // 15,000 x 2
    ["flight_back", 30000],
    ["delhi_after", 27140],
    ["delhi_after_transfer", 3150],
    ["delhi_after_transfer_1", 3150],
  ]);
  assert.equal(p.totals.grand, 658180);
  assert.deepEqual([p.arrival, p.outpost.check_in, p.outpost.check_out, p.departure], ["2027-02-10", "2027-02-11", "2027-02-16", "2027-02-17"]);
  // the balance is due 45 days before they land in Delhi
  assert.equal(p.payments[1].due, "2026-12-27");
});

test("Delhi: same-day connection (0 nights) = the flight only; a typed fare; no flight in Master data = an error", () => {
  const p = priceRedPanda(plan({ arrival: "2027-02-10", delhi_before: delhi(0), g: { adults: 2 } }), WITH_DELHI);
  assert.deepEqual(p.lines.map((l) => l.key), ["package", "flight_out"]);
  assert.equal(p.outpost.check_in, "2027-02-10");
  assert.equal(p.totals.grand, 531300 + 30000);
  const typed = priceRedPanda(plan({ arrival: "2027-02-10", delhi_before: delhi(0), flight_fare_pp: 12500, g: { adults: 2 } }), WITH_DELHI);
  assert.equal(typed.totals.grand, 531300 + 25000);
  const none = priceRedPanda(plan({ arrival: "2027-02-10", delhi_before: delhi(0), g: { adults: 2 } }), { ...WITH_DELHI, delhi: { hotels: [ROSEATE], out: null, back: null } });
  assert.match(none.errors.join(), /No Delhi - Bagdogra flight in Sales Master data/);
  // Delhi nights need a hotel; the flight lands at Bagdogra (not Bhadrapur)
  assert.match(priceRedPanda(plan({ delhi_before: { flight: true, nights: 1, hotel_id: null, room_id: null } }), WITH_DELHI).errors.join(), /choose the Delhi hotel/);
  assert.match(priceRedPanda(plan({ arrive_airport: "BDP", delhi_before: delhi(0) }), WITH_DELHI).errors.join(), /lands at Bagdogra/);
  // Delhi from April: the April rate (17,000 + 18%)
  const apr = priceRedPanda(plan({ arrival: "2027-04-05", delhi_before: delhi(1), g: { adults: 2 } }), WITH_DELHI);
  assert.equal(apr.lines.find((l) => l.key === "delhi_before")!.amount, 17000);
});

// ---------------------------------------------------------------- dates not fixed (13 Nov 2026)

test("dates not fixed: priced on the season's tariff as on its first day, and no date shown anywhere", async () => {
  const { rpSeasons, datelessBasis } = await import("./pricing");
  assert.deepEqual(rpSeasons(MASTER).map((x) => [x.season, x.from, x.to]), [["2026-27", "2026-10-01", "2027-05-31"], ["2025-26", "2025-10-01", "2026-05-31"]]);
  // the newest season when none is chosen
  assert.deepEqual(datelessBasis({ rate_season: null }, MASTER), { season: "2026-27", on: "2026-10-01" });
  // 2 foreign guests, 5 nights, 1 night at Mayfair before: the same price as arriving on 1 Oct 2026
  const base = { g: { adults: 2, nationality: "foreign" as const }, hotel_before: { nights: 1, room_id: "R_jungle" } };
  const dated = priceRedPanda(plan({ ...base, arrival: "2026-10-01" }), MASTER);
  const open = priceRedPanda(plan({ ...base, arrival: null, dateless: true, rate_season: null }), MASTER);
  assert.deepEqual(open.errors, []);
  assert.equal(open.totals.grand, dated.totals.grand);
  assert.equal(open.totals.grand, 253000 * 2 * 1.05 + 17000 * 1.18 + 3150); // 5,31,300 + Mayfair 20,060 + the airport transfer 3,150
  assert.equal(open.season, "2026-27");
  assert.equal(open.dateless, true);
  assert.equal(open.arrival, null);
  assert.equal(open.departure, null);
  assert.deepEqual(open.outpost, { check_in: null, check_out: null });
  assert.equal(open.payments[1].due, null); // the balance: 45 days before arrival, the date not known
  assert.match(open.payments[1].note!, /45 days before arrival/);
  // the older season, when chosen: 2025-26 rates
  const old = priceRedPanda(plan({ g: { adults: 2, nationality: "foreign" }, arrival: null, dateless: true, rate_season: "2025-26" }), MASTER);
  assert.equal(old.season, "2025-26");
  assert.equal(old.totals.package, 230000 * 2);
  // a season not in Master data: the newest, with a warning
  const gone = priceRedPanda(plan({ g: { adults: 2 }, arrival: null, dateless: true, rate_season: "2019-20" }), MASTER);
  assert.equal(gone.season, "2026-27");
  assert.ok(gone.warnings.some((w) => /2019-20 tariff is not in Master data/.test(w)));
  // no tariff at all: a clear error, not a price
  const none = priceRedPanda(plan({ g: { adults: 2 }, arrival: null, dateless: true }), { ...MASTER, tariff: [] });
  assert.ok(none.errors.some((e) => /no Red Panda tariff season/.test(e)));
  // without the tick and without a date: still asks for the date
  assert.ok(priceRedPanda(plan({ g: { adults: 2 }, arrival: null }), MASTER).errors.includes("Add the arrival date."));
});

test("dates not fixed: kept by the plan, read from the enquiry, the date question skipped, the guest page says so", async () => {
  const { readEnquiry } = await import("./reader");
  const { applyReading, nextQuestion, rpConfirmKey } = await import("./assist");
  const { rpGuestContent } = await import("./content");
  const p = sanitizeRpPlan(JSON.parse(JSON.stringify(plan({ arrival: null, dateless: true, rate_season: "2026-27" }))))!;
  assert.equal(p.dateless, true);
  assert.equal(p.rate_season, "2026-27");
  assert.equal(sanitizeRpPlan(JSON.parse(JSON.stringify({ ...plan(), dateless: "yes", rate_season: "<b>" })))!.dateless, undefined);
  for (const m of ["2 adults from UK, dates not fixed, 5 nights", "2 guests, foreign nationals, Dates not decided", "2 adults, no fixed dates yet", "2 adults, dates TBD", "dates not fixed"]) assert.equal(readEnquiry(m, "2026-11-13").dateless, true, m);
  assert.equal(readEnquiry("2 adults arriving 20 Feb 2027", "2026-11-13").dateless, undefined);
  const r = readEnquiry("2 adults from UK, dates not fixed, 5 nights", "2026-11-13");
  const applied = applyReading(emptyRpPlan(), r, SETTINGS);
  assert.equal(applied.plan.dateless, true);
  assert.notEqual(applied.pending, "arrival");
  assert.equal(nextQuestion(applied.plan, r, SETTINGS).pending === "arrival", false);
  // a date given later replaces it
  const later = applyReading(applied.plan, readEnquiry("arriving 20 Feb 2027", "2026-11-13"), SETTINGS);
  assert.equal(later.plan.dateless, undefined);
  assert.equal(later.plan.arrival, "2027-02-20");
  // confirming: the tick is part of what was confirmed; older confirmations (no tick) unchanged
  assert.notEqual(rpConfirmKey({ ...plan({ arrival: null }), dateless: true }), rpConfirmKey(plan({ arrival: null })));
  assert.ok(!rpConfirmKey(plan()).includes("dateless"));
  // the guest page: dates to be confirmed, the season's note under the price, days without dates
  const open = plan({ g: { adults: 2, nationality: "foreign" }, arrival: null, dateless: true });
  const c = rpGuestContent(open, priceRedPanda(open, MASTER), SETTINGS);
  assert.equal(c.glance.find((x) => x.label === "Dates")!.value, "To be confirmed");
  assert.match(c.datelessNote!, /not fixed yet, the price is worked out on the 2026-27 season tariff/);
  assert.ok(c.days.every((d) => d.dateText === ""));
});
