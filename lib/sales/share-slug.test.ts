// Run with:  npx tsx --test lib/sales/share-slug.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isShareSlug, isShareToken, makeShareSlug } from "./share-slug";

test("personalised, unguessable client links", () => {
  const s = makeShareSlug("Ms Sangeeta", "PS-2026-0001");
  assert.match(s, /^sangeeta-ps-2026-0001-[a-z2-9]{8}$/);
  assert.match(makeShareSlug("Judy & Cathy Miller", "PS-2026-0012"), /^judy-cathy-miller-ps-2026-0012-/);
  assert.match(makeShareSlug("Ren\u00e9e D'Souza", "PS-2026-0003"), /^renee-d-souza-ps-2026-0003-/);
  assert.match(makeShareSlug("", "PS-2026-0004"), /^guest-ps-2026-0004-/);
  assert.notEqual(makeShareSlug("A B", "PS-1"), makeShareSlug("A B", "PS-1"));
  assert.ok(isShareSlug(s) && !isShareToken(s));
  assert.ok(isShareToken("58d8226c2cce4243aab804d2da7cedbf") && !isShareSlug("../etc"));
});
