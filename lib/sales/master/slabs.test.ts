// Run with:  npx tsx --test lib/sales/master/slabs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCancellationRows, checkPaymentRows } from "./slabs";

test("rates import: payment schedule must be 0-100% each, whole days, total 100", () => {
  const ok = checkPaymentRows([
    { label: "Deposit", pct: 25, days_before_arrival: null },
    { label: "Second deposit", pct: "25", days_before_arrival: "145" },
    { label: "Final balance", pct: 50, days_before_arrival: 45 },
  ]);
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.rows?.map((r) => [r.pct, r.days_before_arrival]), [[25, null], [25, 145], [50, 45]]);
  // a negative row that still makes the total 100 is refused
  assert.match(checkPaymentRows([{ label: "A", pct: 150 }, { label: "B", pct: -50 }]).error ?? "", /more than 0%/);
  assert.match(checkPaymentRows([{ label: "A", pct: 60 }, { label: "B", pct: 30 }]).error ?? "", /add up to 90/);
  assert.match(checkPaymentRows([{ label: "A", pct: 100, days_before_arrival: 12.5 }]).error ?? "", /whole number/);
  assert.ok(checkPaymentRows("not a list").error);
  assert.ok(checkPaymentRows([]).error);
});

test("rates import: cancellation charges 0-100%, whole days, to not below from", () => {
  const ok = checkCancellationRows([
    { min_days: 60, max_days: null, pct: 10 },
    { min_days: 30, max_days: 59, pct: 50 },
    { min_days: 0, max_days: 29, pct: 100 },
  ]);
  assert.equal(ok.error, undefined);
  assert.equal(ok.rows?.length, 3);
  assert.match(checkCancellationRows([{ min_days: 0, max_days: 29, pct: 500 }]).error ?? "", /0% to 100%/);
  assert.match(checkCancellationRows([{ min_days: 0, max_days: 29, pct: -5 }]).error ?? "", /0% to 100%/);
  assert.match(checkCancellationRows([{ min_days: 30, max_days: 10, pct: 50 }]).error ?? "", /not below/);
  assert.match(checkCancellationRows([{ min_days: "abc", pct: 50 }]).error ?? "", /whole number/);
});
