// Run with:  npx tsx --test lib/sales/versions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canUpdateInPlace, defaultVersionMode } from "./versions";

test("an edited quote: a new version once it was sent, else an update of the current one", () => {
  assert.equal(defaultVersionMode("open"), "update");
  assert.equal(defaultVersionMode("draft"), "update");
  for (const s of ["quoted", "booked", "lost", "cancelled"]) assert.equal(defaultVersionMode(s), "new", s);
});

test("booked, cancelled and lost quotes are never changed in place", () => {
  for (const s of ["booked", "cancelled", "lost"]) assert.equal(canUpdateInPlace(s), false, s);
  for (const s of ["draft", "open", "quoted"]) assert.equal(canUpdateInPlace(s), true, s);
  assert.equal(canUpdateInPlace(null), false);
});
