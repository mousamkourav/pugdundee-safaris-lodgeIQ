// Run with:  npx tsx --test lib/redpanda/reader.test.ts
// The Red Panda trip assistant: the built-in reader on enquiries written the way they come in,
// the AI's evidence rule (values without a quote that says them are dropped), the merge (AI
// first), what goes to the AI (no names, emails, phones), the questions asked, the Confirm step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readEnquiry } from "./reader";
import { checkRpEvidence, mergeReadings, scrubRp } from "./ai";
import { applyReading, isRpConfirmed, mentionsOtherPlaces, replyText, rpConfirmKey, salesHandoffText, tripSummary } from "./assist";
import { emptyRpPlan, readSettings, sanitizeRpPlan } from "./plan";

const TODAY = "2026-11-06";
const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "red_panda.sql"), "utf8");
const S = readSettings(JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(SQL)![1]));
const ROOMS = [{ id: "R1", name: "Jungle View Room" }, { id: "R2", name: "Mountain View Room" }];
const read = (t: string, pending: Parameters<typeof readEnquiry>[2] extends infer O ? (O extends { pending?: infer P } ? P : never) : never = null) =>
  readEnquiry(t, TODAY, { pending, hotelRooms: ROOMS.map((r) => r.name) });

test("a full enquiry: guests, country, date, nights, airport, hotel after, contact details", () => {
  const r = read("Hi, Mr John Hill and wife from the UK want the red panda trip, arriving 20 Nov at Bagdogra, 5 nights, then 1 night at Mayfair jungle view before flying out. john@hill.co.uk +44 7700 900123");
  assert.equal(r.name, "Mr John Hill");
  assert.equal(r.email, "john@hill.co.uk");
  assert.match(r.phone ?? "", /7700 900123/);
  assert.equal(r.nationality, "foreign");
  assert.equal(r.country, "United Kingdom");
  assert.equal(r.arrival, "2026-11-20");
  assert.equal(r.nights, 5);
  assert.equal(r.arrive_airport, "IXB");
  assert.equal(r.depart_airport, "IXB");
  assert.deepEqual(r.hotel_after, { nights: 1, room: "Jungle View Room" });
  assert.equal(r.hotel_before, undefined);
});

test("short forms: 4 pax indian, 5N6D, 12/03/2027, bhadrapur in bagdogra out, 2 rooms, tour leader", () => {
  const r = read("4 pax indian 5N6D from 12/03/2027, fly in bhadrapur and depart from bagdogra, 2 rooms, with tour leader");
  assert.deepEqual([r.adults, r.nationality, r.nights, r.arrival, r.arrive_airport, r.depart_airport, r.rooms, r.tour_leader], [4, "indian", 5, "2027-03-12", "BDP", "IXB", 2, true]);
});

test("couple, solo, family of 4 with two teenagers, ages", () => {
  assert.equal(read("a couple from Germany, 2nd week of march").adults, 2);
  assert.equal(read("solo traveller from Australia").adults, 1);
  const f = read("family of 4 with 2 kids aged 16 and 17 from USA, 6 days in april");
  assert.deepEqual([f.adults, f.child_ages, f.country, f.nights], [2, [16, 17], "United States", 5]);
  const c = read("2 adults and 1 child");
  assert.deepEqual([c.adults, c.child_ages, c.children], [2, undefined, 1]);
});

test("an agent's enquiry: B2B, the agency's name", () => {
  const r = read("Dear team, our client (2 adults, Dutch) via Wild Nature Travels. Agent rates please for 15th Jan 2027, 5 nights.");
  assert.equal(r.booked_by, "agent");
  assert.equal(r.agent_name, "Wild Nature Travels");
  assert.equal(r.country, "Netherlands");
  assert.equal(r.arrival, "2027-01-15");
});

test("dates: no year = the next one; arrival - departure gives the nights (less the hotel nights)", () => {
  assert.equal(read("arriving 3 feb").arrival, "2027-02-03");
  assert.equal(read("arriving 25 dec").arrival, "2026-12-25");
  assert.equal(read("arriving on 2026-12-01").arrival, "2026-12-01");
  const r = read("2 adults, 10 March to 16 March 2027, 1 night in Siliguri on arrival");
  assert.equal(r.arrival, "2027-03-10");
  assert.deepEqual(r.hotel_before, { nights: 1 });
  assert.equal(r.nights, 5); // 6 nights in all, 1 at the hotel
});

test("a bare answer goes to the question asked", () => {
  assert.equal(read("3", "adults").adults, 3);
  assert.equal(read("6", "nights").nights, 6);
  assert.deepEqual(read("16, 18", "ages").child_ages, [16, 18]);
  assert.equal(read("foreigners", "nationality").nationality, "foreign");
  assert.equal(read("indian", "nationality").nationality, "indian");
  assert.equal(read("20 nov", "arrival").arrival, "2026-11-20");
  assert.equal(read("3").adults, undefined); // no question: not guessed
});

test("the AI's evidence rule: kept with a quote that says it, dropped otherwise", () => {
  const msg = "2 adults from France arriving 20 nov at bagdogra for 5 nights, 1 night mayfair after";
  const { reading, dropped } = checkRpEvidence(
    {
      adults: { value: 2, quote: "2 adults" },
      country: { value: "France", quote: "from France" },
      nationality: { value: "foreign", quote: "from France" },
      arrival: { value: "2026-11-20", quote: "arriving 20 nov" },
      nights: { value: 6, quote: "5 nights" }, // wrong number: 6 is in "5 nights"? no
      arrive_airport: { value: "BDP", quote: "at bagdogra" }, // wrong airport
      tour_leader: { value: true, quote: "with a tour leader" }, // not in the message
      hotel_after: { value: { nights: 1 }, quote: "1 night mayfair after" },
    },
    msg,
    ["Jungle View Room"]
  );
  assert.deepEqual(reading, { adults: 2, country: "France", nationality: "foreign", arrival: "2026-11-20", hotel_after: { nights: 1 } });
  assert.deepEqual(dropped.map((d) => d.field).sort(), ["arrive_airport", "nights", "tour_leader"]);
  // a made-up date is dropped
  assert.equal(checkRpEvidence({ arrival: { value: "2026-12-21", quote: "arriving 20 nov" } }, msg, []).reading.arrival, undefined);
  // junk answers: nothing
  assert.deepEqual(checkRpEvidence("nonsense", msg, []).reading, {});
  assert.deepEqual(checkRpEvidence({ adults: { value: "2", quote: "2 adults" } }, msg, []).reading, {});
});

test("merge: the AI's value wins, the reader fills what the AI left empty", () => {
  const m = mergeReadings({ adults: 2, nights: 5 }, { adults: 3, arrival: "2026-11-20", name: "Mr X", email: "x@y.z" });
  assert.deepEqual(m.reading, { adults: 2, nights: 5, arrival: "2026-11-20", name: "Mr X", email: "x@y.z" });
  assert.deepEqual(m.added, ["arrival"]);
});

test("nothing personal goes to the AI; dates stay", () => {
  const s = scrubRp("Mr John Hill (john@hill.co.uk, +44 7700 900123) and Mary Hill arriving 20/11/2026", ["Mary Hill"]);
  assert.doesNotMatch(s, /John|Hill|Mary|@|7700/);
  assert.match(s, /20\/11\/2026/);
});

test("the assistant fills the quote, says what it understood and asks one question at a time", () => {
  let a = applyReading(emptyRpPlan(), read("2 adults from Germany, 5 nights"), S, ROOMS);
  assert.equal(a.plan.guest.country, "Germany");
  assert.equal(a.pending, "arrival");
  assert.match(replyText(a, ""), /Understood: 2 adults; from Germany; 5 nights at Red Panda Outpost\.\nOn which date/);
  a = applyReading(a.plan, read("14 feb", a.pending), S, ROOMS);
  assert.equal(a.plan.arrival, "2027-02-14");
  assert.equal(a.ready, true);
  // Indian or foreign is asked for a direct guest with no country
  const b = applyReading(emptyRpPlan(), read("2 adults, 20 nov, 5 nights"), S, ROOMS);
  assert.equal(b.pending, "nationality");
  // children without ages: the ages are asked
  const c = applyReading(emptyRpPlan(), read("2 adults 1 child from UK 20 nov"), S, ROOMS);
  assert.equal(c.pending, "ages");
  // hotel nights without a room type: asked (two room types)
  const d = applyReading(emptyRpPlan(), read("2 adults from UK 20 nov 5 nights, 1 night siliguri before"), S, ROOMS);
  assert.match(d.question ?? "", /Jungle View Room or Mountain View Room/);
  // hotel nights through Bhadrapur: Bagdogra is set for that side
  assert.equal(d.plan.arrive_airport, "IXB");
  // the room answered (a tap on its name, or a word of it)
  assert.equal(d.pending, "hotel_room");
  const e = applyReading(d.plan, read("mountain", d.pending), S, ROOMS);
  assert.equal(e.plan.hotel_before.room_id, "R2");
  assert.equal(e.ready, true);
});

test("Confirm: the trip in plain words; the confirmation holds only for that trip; the server keeps it", () => {
  const p = { ...emptyRpPlan(), arrival: "2026-11-20", hotel_after: { nights: 1, room_id: "R1" }, guest: { ...emptyRpPlan().guest, adults: 2, country: "France" } };
  const lines = tripSummary(p, S, "Mayfair Chumta").map((l) => l.text);
  assert.deepEqual(lines, [
    "2 adults; foreign (France); direct guest.",
    "Fri, 20 Nov 2026: land at Bagdogra Airport (IXB), Siliguri, India.",
    "5 nights at Red Panda Outpost.",
    "1 night at Mayfair Chumta.",
    "Fly out from Bagdogra Airport (IXB), Siliguri, India.",
  ]);
  const ok = { ...p, confirmed: rpConfirmKey(p) };
  assert.equal(isRpConfirmed(ok), true);
  assert.equal(isRpConfirmed({ ...ok, nights: 6 }), false);
  assert.equal(isRpConfirmed({ ...ok, notes: "changed" }), true); // notes are not the trip
  // the server's check of the browser's plan keeps the key and the guest text
  const back = sanitizeRpPlan(JSON.parse(JSON.stringify({ ...ok, text: { intro: "Hello", days: { "2": "Our day", x: "bad" }, notes: ["Bring a hat"] } })));
  assert.equal(isRpConfirmed(back), true);
  assert.deepEqual(back.text, { intro: "Hello", days: { "2": "Our day" }, notes: ["Bring a hat"] });
});

test("the test enquiry on the real Mayfair room names (Master data export of 2 Nov 2026)", () => {
  const real = [{ id: "J", name: "Jungle View Room (double bed)" }, { id: "M", name: "Mountain View Room (twin beds, balcony)" }];
  const msg = "Hi team, Mr David Clarke and his wife from the UK want to see the red panda. They land at Bagdogra on 12 Feb 2027 and want 5 nights at the Outpost, then 1 night at Mayfair (mountain view) before flying out of Bagdogra. david.clarke@example.com";
  const r = readEnquiry(msg, TODAY, { hotelRooms: real.map((x) => x.name) });
  assert.deepEqual(
    [r.name, r.email, r.adults, r.country, r.arrival, r.nights, r.arrive_airport, r.depart_airport, r.hotel_after, r.hotel_before],
    ["Mr David Clarke", "david.clarke@example.com", 2, "United Kingdom", "2027-02-12", 5, "IXB", "IXB", { nights: 1, room: "Mountain View Room (twin beds, balcony)" }, undefined]
  );
  const a = applyReading(emptyRpPlan(), r, S, real);
  assert.equal(a.plan.hotel_after.room_id, "M");
  assert.equal(a.ready, true);
  // a tap on the room's name, or a word of it
  assert.equal(readEnquiry("Jungle View Room (double bed)", TODAY, { pending: "hotel_room", hotelRooms: real.map((x) => x.name) }).hotel_room, "Jungle View Room (double bed)");
  assert.equal(readEnquiry("jungle", TODAY, { pending: "hotel_room", hotelRooms: real.map((x) => x.name) }).hotel_room, "Jungle View Room (double bed)");
});

test("other places (Delhi, Kaziranga, our lodges): the trip goes to the Sales builder with the enquiry", () => {
  assert.equal(mentionsOtherPlaces("2 adults, delhi 1 night then red panda"), true);
  assert.equal(mentionsOtherPlaces("then kaziranga 3 nights"), true);
  assert.equal(mentionsOtherPlaces("2 adults from UK, bagdogra, 5 nights, mayfair after"), false);
  const p = { ...emptyRpPlan(), enquiry: "2 adults from UK\n---\nalso delhi 1 night first" };
  assert.equal(salesHandoffText(p, S), "2 adults from UK\nalso delhi 1 night first");
  const q = { ...emptyRpPlan(), arrival: "2027-02-12", hotel_after: { nights: 1, room_id: "R1" }, guest: { ...emptyRpPlan().guest, adults: 2, country: "United Kingdom" } };
  assert.equal(salesHandoffText(q, S), "2 adults, from United Kingdom, arriving bagdogra on 12 Feb 2027, red panda outpost 5 nights, then 1 night at mayfair chumta, fly out from bagdogra");
});
