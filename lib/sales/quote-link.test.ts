// Client links /quote/<name-code>/<version> (10 Nov 2026)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientLinkPath, isQuoteKey, isVersionNo, quotePath } from "./quote-link";

test("the key: name words + 6 characters without look-alikes; the version a plain number", () => {
  for (const k of ["jj-lheureux-55c8av", "barney-smith-jthy7u", "guest-ywzzwn", "anders-ost-mgh32i", "sangeeta-kakaria-4yei4p"]) assert.ok(isQuoteKey(k), k);
  for (const k of ["jj-lheureux", "jj-lheureux-55c8a", "jj-lheureux-55c8avx", "jj-lheureux-55c8a0", "jj-lheureux-55c8a1", "jj-lheureux-55c8al", "jj-lheureux-55c8ao", "JJ-lheureux-55c8av", "../etc-passwd-abcdef", "jj--x-abcdef", `${"a".repeat(40)}-abcdef`, ""]) assert.ok(!isQuoteKey(k), k);
  for (const v of ["1", "2", "12", "999"]) assert.ok(isVersionNo(v));
  for (const v of ["0", "01", "1000", "-1", "1.5", "a", ""]) assert.ok(!isVersionNo(v), v);
  assert.equal(quotePath("jj-lheureux-55c8av", 2), "/quote/jj-lheureux-55c8av/2");
});

test("every version: the new link when the quote has its key, else the old one", () => {
  assert.equal(clientLinkPath("jj-lheureux-55c8av", { version_no: 1, share_slug: "jj-x-ps-1-abcdefgh" }), "/quote/jj-lheureux-55c8av/1");
  assert.equal(clientLinkPath("jj-lheureux-55c8av", { version_no: 2, share_slug: null, share_token: "a".repeat(32) }), "/quote/jj-lheureux-55c8av/2");
  assert.equal(clientLinkPath(null, { version_no: 3, share_slug: "jj-x-ps-1-abcdefgh" }), "/i/jj-x-ps-1-abcdefgh");
  assert.equal(clientLinkPath(undefined, { version_no: 3, share_slug: null, share_token: "f".repeat(32) }), `/i/${"f".repeat(32)}`);
  // a key that is not one of ours is never put in a link
  assert.equal(clientLinkPath("bad key", { version_no: 1, share_slug: "s-ps-1-abcdefgh" }), "/i/s-ps-1-abcdefgh");
});

test("the database makes keys the app accepts, and the links are public only through the guard", () => {
  const sql = readFileSync("supabase/sales_quote_links.sql", "utf8");
  const alphabet = /alphabet constant text := '([a-z0-9]+)'/.exec(sql)![1];
  assert.equal(alphabet.length, 32);
  assert.ok(!/[l1o0]/.test(alphabet));
  for (const ch of alphabet) assert.ok(isQuoteKey(`name-${ch.repeat(6)}`), ch);
  // the new link is public in the middleware (like /i/), and its page checks the guard first
  assert.match(readFileSync("middleware.ts", "utf8"), /path\.startsWith\("\/quote\/"\)/);
  const page = readFileSync("app/quote/[key]/[v]/page.tsx", "utf8").split("export default")[1];
  assert.ok(page.indexOf("isBlocked(") < page.indexOf("resolveQuoteLink(key"), "blocked devices are stopped before any lookup");
  assert.match(page, /recordMiss\(who\)/);
  const old = readFileSync("app/i/[token]/page.tsx", "utf8");
  assert.match(old, /isBlocked\(who\)/);
  assert.match(old, /linkOff\(qid\)/);
  // the misses table is closed to signed-in users and visitors; only the app reads it
  assert.match(sql, /revoke all on public\.sales_link_misses from anon, authenticated/);
  assert.match(sql, /alter table public\.sales_link_misses enable row level security/);
});
