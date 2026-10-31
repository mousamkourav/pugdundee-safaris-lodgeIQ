// Run with:  npx tsx --test lib/sales/format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDay } from "./format";

test("a trip day shows its weekday and the year", () => {
  assert.equal(fmtDay("2027-01-16"), "Sat, 16 Jan 2027");
  assert.equal(fmtDay("2027-04-01"), "Thu, 1 Apr 2027");
  assert.equal(fmtDay(""), "");
  assert.equal(fmtDay("soon"), "");
});
