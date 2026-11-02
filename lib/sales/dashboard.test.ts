// Run with:  npx tsx --test lib/sales/dashboard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDashboardRange, rangeHref, inRange } from "./dashboard-range";
import { summarise, followUps, byMember, conversion } from "./dashboard-summary";

// 2 Nov 2026, 10:00 in India
const NOW = new Date("2026-11-02T04:30:00Z");

test("the dashboard counts ALL TIME when no period is chosen", () => {
  for (const sp of [{}, { range: "" }, { range: "nonsense" }, { range: null }]) {
    const r = resolveDashboardRange(sp, NOW);
    assert.equal(r.key, "all");
    assert.equal(r.from, null);
    assert.equal(r.to, null);
    assert.match(r.label, /since the start/);
  }
  assert.equal(rangeHref("/sales", resolveDashboardRange({}, NOW)), "/sales");
});

test("calendar periods start and end at midnight India time", () => {
  const month = resolveDashboardRange({ range: "month" }, NOW);
  assert.equal(month.from, "2026-10-31T18:30:00.000Z"); // 1 Nov 00:00 IST
  assert.equal(month.to, "2026-11-02T18:30:00.000Z"); // end of today (3 Nov 00:00 IST)
  assert.equal(month.label, "Queries created 1 Nov 2026 to 2 Nov 2026");

  const last = resolveDashboardRange({ range: "last" }, NOW);
  assert.equal(last.from, "2026-09-30T18:30:00.000Z");
  assert.equal(last.to, "2026-10-31T18:30:00.000Z");
  assert.equal(last.label, "Queries created 1 Oct 2026 to 31 Oct 2026");

  const last3 = resolveDashboardRange({ range: "last3" }, NOW);
  assert.equal(last3.fromDay, "2026-09-01");
  assert.equal(last3.toDay, "2026-11-02");

  const year = resolveDashboardRange({ range: "year" }, NOW);
  assert.equal(year.from, "2025-12-31T18:30:00.000Z");
  assert.equal(year.label, "Queries created 1 Jan 2026 to 2 Nov 2026");
});

test("periods across the new year and early-morning India time", () => {
  // 00:10 on 1 Jan 2027 in India is still 31 Dec in UTC
  const jan1 = new Date("2027-01-01T00:10:00+05:30");
  assert.equal(resolveDashboardRange({ range: "month" }, jan1).fromDay, "2027-01-01");
  assert.equal(resolveDashboardRange({ range: "last" }, jan1).fromDay, "2026-12-01");
  assert.equal(resolveDashboardRange({ range: "last" }, jan1).toDay, "2026-12-31");
  assert.equal(resolveDashboardRange({ range: "last3" }, jan1).fromDay, "2026-11-01");
  assert.equal(resolveDashboardRange({ range: "year" }, jan1).fromDay, "2027-01-01");
});

test("custom range: both days included, reversed dates swapped, bad dates refused", () => {
  const r = resolveDashboardRange({ range: "custom", from: "2026-10-05", to: "2026-10-10" }, NOW);
  assert.equal(r.from, "2026-10-04T18:30:00.000Z");
  assert.equal(r.to, "2026-10-10T18:30:00.000Z"); // 11 Oct 00:00 IST, exclusive
  assert.equal(r.label, "Queries created 5 Oct 2026 to 10 Oct 2026");
  assert.equal(rangeHref("/sales", r), "/sales?range=custom&from=2026-10-05&to=2026-10-10");
  // a query at 23:59 IST on 10 Oct is in; 00:00 on 11 Oct is out
  assert.equal(inRange("2026-10-10T18:29:00Z", r), true);
  assert.equal(inRange("2026-10-10T18:30:00Z", r), false);
  assert.equal(inRange("2026-10-04T18:29:59Z", r), false);

  const swapped = resolveDashboardRange({ range: "custom", from: "2026-10-10", to: "2026-10-05" }, NOW);
  assert.equal(swapped.fromDay, "2026-10-05");
  assert.equal(swapped.toDay, "2026-10-10");

  const onlyFrom = resolveDashboardRange({ range: "custom", from: "2026-10-05" }, NOW);
  assert.equal(onlyFrom.to, null);
  assert.equal(onlyFrom.label, "Queries created 5 Oct 2026 to 2 Nov 2026");

  const onlyTo = resolveDashboardRange({ range: "custom", to: "2026-10-05" }, NOW);
  assert.equal(onlyTo.from, null);
  assert.equal(onlyTo.label, "Queries created up to 5 Oct 2026");

  for (const bad of [{ from: "2026-02-31" }, { from: "yesterday" }, { from: "", to: "" }, { from: "1999-01-01" }]) {
    const b = resolveDashboardRange({ range: "custom", ...bad }, NOW);
    assert.equal(b.key, "all");
    assert.ok(b.note);
  }
});

const row = (status: string, total: number | null, booked: number | null = null, created = "2026-10-01T00:00:00Z", assigned_to: string | null = "m1") =>
  ({ status, total_amount: total, booked_amount: booked, created_at: created, assigned_to }) as never;

test("cards: drafts apart, booked value, received, pending value", () => {
  const t = summarise([
    row("draft", 99_000),
    row("open", 100_000),
    row("quoted", 250_000),
    row("booked", 400_000, 120_000),
    row("booked", 150_500, null),
    row("lost", 80_000),
    row("cancelled", 60_000),
    row("open", null),
  ]);
  assert.deepEqual(t, {
    draft: 1,
    created: 7,
    open: 2,
    quoted: 1,
    booked: 2,
    lost: 1,
    cancelled: 1,
    bookedValue: 550_500,
    received: 120_000,
    pendingValue: 350_000,
  });
  assert.equal(conversion(t), 29);
  assert.equal(conversion(summarise([])), 0);
  // numbers from Postgres numeric arrive as strings
  assert.equal(summarise([row("booked", "1000.50" as never, "200" as never)]).bookedValue, 1000.5);
});

test("follow-ups are the open and quoted queries of the period, newest first", () => {
  const rows = [
    row("open", 1, null, "2026-10-01T00:00:00Z"),
    row("booked", 1, null, "2026-10-05T00:00:00Z"),
    row("quoted", 1, null, "2026-10-09T00:00:00Z"),
    row("open", 1, null, "2026-10-03T00:00:00Z"),
  ];
  const f = followUps(rows, 2) as unknown as { created_at: string }[];
  assert.deepEqual(f.map((r) => r.created_at), ["2026-10-09T00:00:00Z", "2026-10-03T00:00:00Z"]);
});

test("member table: totals per member, active members with no query listed, best first", () => {
  const rows = [row("booked", 500, 100, undefined, "a"), row("open", 300, null, undefined, "b"), row("booked", 100, 0, undefined, "b"), row("open", 1, null, undefined, null)];
  const team = byMember(rows, [{ id: "c", status: "active" }, { id: "d", status: "disabled" }], { a: "Asha", b: "Bilal", c: "Chetan" });
  assert.deepEqual(team.map((m) => [m.name, m.t.created, m.t.bookedValue]), [["Asha", 1, 500], ["Bilal", 2, 100], ["Chetan", 0, 0]]);
});
