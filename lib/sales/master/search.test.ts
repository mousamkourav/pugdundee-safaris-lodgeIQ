// Run with:  npx tsx --test lib/sales/master/search.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSearch, normaliseSearch } from "./search";

const row = normaliseSearch("Kings Lodge - AC Deluxe Cottage 01 Feb 2027 31 Mar 2027 AP ₹22,000 Active Tadoba-Andhari Tiger Reserve");

test("every word must match, in any order and any case", () => {
  assert.ok(matchesSearch(row, "kings deluxe"));
  assert.ok(matchesSearch(row, "AP KINGS"));
  assert.ok(!matchesSearch(row, "kings treehouse"));
});

test("punctuation is ignored: Tadoba-Andhari = tadoba andhari", () => {
  assert.ok(matchesSearch(row, "tadoba andhari"));
  assert.ok(matchesSearch(row, "Tadoba-Andhari"));
});

test("prices and dates are searchable as shown", () => {
  assert.ok(matchesSearch(row, "22"));
  assert.ok(matchesSearch(row, "feb 2027"));
});

test("an empty search matches everything", () => {
  assert.ok(matchesSearch(row, "   "));
});
