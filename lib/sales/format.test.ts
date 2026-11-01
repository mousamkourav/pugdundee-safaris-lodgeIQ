// Run with:  npx tsx --test lib/sales/format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDay, startOfMonthIST, startOfLastMonthIST } from "./format";

test("a trip day shows its weekday and the year", () => {
  assert.equal(fmtDay("2027-01-16"), "Sat, 16 Jan 2027");
  assert.equal(fmtDay("2027-04-01"), "Thu, 1 Apr 2027");
  assert.equal(fmtDay(""), "");
  assert.equal(fmtDay("soon"), "");
});

test("this month and last month start at midnight India time, also across the new year", () => {
  // 1 Nov 2026, 10:15 am in India: this month is from 1 Nov, last month from 1 Oct
  const nov1 = new Date("2026-11-01T04:45:00Z");
  assert.equal(startOfMonthIST(nov1), "2026-10-31T18:30:00.000Z");
  assert.equal(startOfLastMonthIST(nov1), "2026-09-30T18:30:00.000Z");
  // 00:10 on 1 Jan 2027 in India is still 31 Dec in UTC: this month is January
  const jan1 = new Date("2027-01-01T00:10:00+05:30");
  assert.equal(startOfMonthIST(jan1), "2026-12-31T18:30:00.000Z");
  assert.equal(startOfLastMonthIST(jan1), "2026-11-30T18:30:00.000Z");
});
