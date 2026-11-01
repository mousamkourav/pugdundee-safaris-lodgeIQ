// Run with:  npx tsx --test lib/sales/plan/evidence.test.ts
// The evidence rule's matching: a quote must be in the message (small typos allowed, numbers
// exact, not across a comma) and must state the value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvidence, phraseIn, quoteFound, statesNumber } from "./evidence";
import { roseateCtx as ctx } from "./reader-fixture";

test("a quote is in the message: case, punctuation and small typos do not matter", () => {
  const msg = "2 Adults from Germany; Kanha 3 nights, then Pench 2 nights";
  assert.ok(quoteFound("kanha 3 nights", msg));
  assert.ok(quoteFound("KANHA 3 NIGHTS", msg));
  assert.ok(quoteFound("kahna 3 nights", msg)); // one letter swapped
  assert.ok(quoteFound("2 adults from germany", msg));
  assert.ok(!quoteFound("kanha 4 nights", msg)); // never a different number
  assert.ok(!quoteFound("bandhavgarh 3 nights", msg));
  assert.ok(!quoteFound("", msg));
  assert.ok(!quoteFound(3, msg));
});

test("a quote does not run across a comma unless it has one", () => {
  const msg = "3 nights Kanha, 2 nights Pench";
  assert.ok(!quoteFound("kanha 2 nights", msg));
  assert.ok(quoteFound("Kanha, 2 nights", msg));
});

test("a number is stated as digits, a word or a Hindi word", () => {
  assert.ok(statesNumber("3 nights", 3));
  assert.ok(statesNumber("3n", 3));
  assert.ok(statesNumber("teen raat", 3));
  assert.ok(statesNumber("a couple", 2));
  assert.ok(statesNumber("7 aur 12 saal", 12));
  assert.ok(!statesNumber("13 nights", 3));
  assert.ok(phraseIn("waghoba", "3 nigths waghoba"));
});

test("each value is checked against its own quote", () => {
  const msg = "2 adults from UK, Kanha 3 nights at Kanha Earth Lodge in a cottage, all safaris with naturalist, fly Delhi to Jabalpur";
  const { reading, dropped } = checkEvidence(
    {
      adults: { value: 2, quote: "2 adults" },
      stops: [
        {
          park: { value: "Kanha National Park", quote: "Kanha 3 nights" },
          lodge: { value: "Kanha Earth Lodge", quote: "Kanha Earth Lodge" },
          room: { value: "cottage", quote: "in a cottage" },
          nights: { value: 3, quote: "Kanha 3 nights" },
          naturalists: { value: -1, quote: "all safaris with naturalist" },
        },
      ],
      flights: [
        { from: "Delhi", to: "Jabalpur", quote: "fly Delhi to Jabalpur" },
        { from: "Mumbai", to: "Jabalpur", quote: "fly Delhi to Jabalpur" }, // Mumbai is not in the message
      ],
      rooms: { value: 2 }, // no quote
    },
    msg,
    ctx
  );
  assert.deepEqual(reading.stops, [{ park: "Kanha National Park", lodge: "Kanha Earth Lodge", room: "cottage", nights: 3, naturalists: -1 }]);
  assert.deepEqual(reading.flights, [{ from: "Delhi", to: "Jabalpur" }]);
  assert.equal(reading.adults, 2);
  assert.deepEqual(dropped.map((d) => `${d.field}: ${d.reason}`), ["rooms: no quote", "flights[1]: quote does not say it"]);
});
