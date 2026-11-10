// The price check for Excel (10 Nov 2026): numbers only, and every row and the total add up, on a
// trip like the one the G. Manager checked (JJ: Delhi, Bandhavgarh with a full day, Kanha, Pench
// with a bush dinner for two, the 3-lodge offer).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTurn, initialFlags } from "@/lib/sales/plan/chat";
import { emptyPlan, planToTrip } from "@/lib/sales/plan/planner";
import { markConfirmed } from "@/lib/sales/plan/confirm";
import { realCtx } from "@/lib/sales/plan/real-fixture";
import { priceTrip } from "./engine";
import { detailedBreakdown } from "./breakdown";
import { priceCheckCsv, unitRate } from "./price-csv";

const T = "2026-11-10";
const MSG =
  "2 adults from UK, 1 room, arriving Delhi 18 feb 2027, Delhi 1 night at Roseate House, fly Delhi to Jabalpur, Bandhavgarh 4 nights at Kings Lodge with a full-day safari, Kanha 3 nights at Kanha Earth Lodge, Pench 3 nights at Pench Tree Lodge with bush dinner, drive to Nagpur, fly Nagpur to Delhi, Delhi 1 night at Roseate House, naturalist on every safari";

test("price check for Excel: plain numbers; Qty x Rate = Before GST, + GST = Amount, rows add up to the total", () => {
  const p = markConfirmed(chatTurn(emptyPlan(T), initialFlags(emptyPlan(T)), MSG, realCtx, T).plan, T);
  const res = priceTrip(planToTrip(p, T), realCtx.pricing);
  assert.deepEqual(res.errors, []);
  const rows = detailedBreakdown(res, { spreadMarkup: false, groupNights: false }).rows;
  assert.ok(rows.length > 30);
  for (const r of rows) {
    assert.ok(Math.abs(unitRate(r) * r.quantity - r.net) < 0.02 * Math.max(1, r.quantity), `${r.label}: ${r.quantity} x ${unitRate(r)} vs ${r.net}`);
    assert.ok(Math.abs(r.net + r.gst - r.amount) <= 1, `${r.label}: ${r.net} + ${r.gst} vs ${r.amount}`);
  }
  // the rows add up to the quote's total (to the rupee)
  const sum = rows.reduce((t, r) => t + r.amount, 0);
  assert.ok(Math.abs(sum - res.totals.grand) <= 1, `${sum} vs ${res.totals.grand}`);
  // the file: no Rs sign, no thousands commas inside numbers; a qty-2 line shows its rate per unit
  const csv = priceCheckCsv(rows, { total: res.totals.grand });
  assert.ok(!/₹|Rs/.test(csv.replace(/Roseate|Rs?\b(?=\w)/g, "")), "no rupee sign");
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "Date,Service,Qty,Rate before GST,Before GST,GST %,GST,Amount");
  assert.equal(lines.length, rows.length + 2);
  for (const l of lines.slice(1)) {
    const cols = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ""));
    for (const c of cols.slice(2)) assert.ok(c === "" || /^-?\d+(\.\d+)?$/.test(c), `number cell: ${c} in ${l}`);
  }
  assert.ok(lines[lines.length - 1].endsWith(`,${res.totals.grand}`));
  const dinner = rows.find((r) => /Bush dinner/i.test(r.label));
  if (dinner) {
    assert.equal(dinner.quantity, 2);
    assert.equal(unitRate(dinner), 4000);
    assert.equal(dinner.net, 8000);
  }
});

test("price check for Excel: names with commas or quotes stay in one cell; dateless quotes have no Date", () => {
  const csv = priceCheckCsv(
    [{ lkey: null, date: null, label: 'Kings Lodge, "AC" Cottage', quantity: 3, net: 1000, gstPct: 18, gst: 180, amount: 1180 }],
    { total: 1180, dateless: true }
  );
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "Service,Qty,Rate before GST,Before GST,GST %,GST,Amount");
  assert.equal(lines[1], '"Kings Lodge, ""AC"" Cottage",3,333.33,1000,18,180,1180');
  assert.equal(lines[2], "Total,,,1000,,180,1180");
});
