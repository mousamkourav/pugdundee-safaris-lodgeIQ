// Run with:  npx tsx --test lib/redpanda/redpanda.test.ts
// Red Panda around the price: who sees the tab, the guest text (dated days with the year), the
// guest page renders (and shows nothing internal), the Payments booking of a booked quote, the
// Master data checks, and that a Red Panda quote never reaches the Safari pricing engine, planner,
// reader or guest page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readAccess } from "./access";
import { modulesFor, moduleForPath, NAV } from "@/components/nav";
import { priceRedPanda, guestBreakup } from "./pricing";
import { emptyRpPlan, isRedPandaPlan, readSettings, sanitizeRpPlan } from "./plan";
import { rpGuestContent } from "./content";
import { checkMoneyInput, checkSettingsInput } from "./master";
import { bookingFromVersion } from "@/lib/sales/payments/from-version";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import { RedPandaGuestPage } from "@/components/redpanda/guest-page";
import type { RpClientView } from "./client-view";
import type { RpMaster, RpPlan } from "./types";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SQL = src("supabase/red_panda.sql");
const SETTINGS = readSettings(JSON.parse(/\$json\$([\s\S]*?)\$json\$/.exec(SQL)![1]));

const MASTER: RpMaster = {
  tariff: (["b2b", "foreign", "indian"] as const).flatMap((market, i) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((guests) => ({ season: "2026-27", valid_from: "2026-10-01", valid_to: "2027-05-31", market, guests, per_pax: [220000, 253000, 235000][i], active: true }))
  ),
  supplements: [],
  settings: SETTINGS,
  hotel: {
    property_id: "H",
    name: "Mayfair Chumta",
    rooms: [{ id: "R_jungle", name: "Jungle View Room", rates: [{ valid_from: "2026-10-01", valid_to: "2027-05-31", meal_plan: "AP", rate_single: 15500, rate_double: 17000, tax_pct: 18, rates_include_tax: false }] }],
    transfer: { rate: 3000, tax_pct: 5, capacity: 6, vehicle_type: "Innova / Crysta", valid_from: null, valid_to: "2027-09-30" },
  },
};
const plan = (o: Partial<RpPlan> = {}): RpPlan => ({ ...emptyRpPlan(), arrival: "2026-11-20", ...o, guest: { ...emptyRpPlan().guest, name: "Ann Hill", adults: 2, ...(o.guest ?? {}) } });

// ------------------------------------------------------------------ access

test("access: Sales users given access (or the super admin); never Lodge Reporting accounts", () => {
  assert.deepEqual(readAccess({ can_use: true, is_editor: true }, "super_admin"), { canUse: true, isEditor: true });
  assert.deepEqual(readAccess({ can_use: true, is_editor: false }, "sales_member"), { canUse: true, isEditor: false });
  assert.deepEqual(readAccess({ can_use: false, is_editor: false }, "sales_member"), { canUse: false, isEditor: false });
  assert.deepEqual(readAccess({ can_use: true }, "lodge_manager"), { canUse: false, isEditor: false });
  assert.deepEqual(readAccess(null, "super_admin"), { canUse: false, isEditor: false }); // SQL not run: nothing shows
  assert.equal(readAccess({ can_use: true, is_editor: true }, "senior_manager").isEditor, false); // only the super admin edits
});

test("the tab: shown only with access; without it the tabs are what they were", () => {
  const keys = (r: Parameters<typeof modulesFor>[0], sop: boolean, rp: boolean) => modulesFor(r, sop, rp).map((m) => m.key);
  assert.deepEqual(keys("super_admin", true, false), ["reporting", "sales", "sop"]);
  assert.deepEqual(keys("super_admin", true, true), ["reporting", "sales", "sop", "redpanda"]);
  assert.deepEqual(keys("sales_member", false, false), []);
  assert.deepEqual(keys("sales_member", false, true), ["sales", "redpanda"]);
  assert.deepEqual(keys("sales_member", true, true), ["sales", "sop", "redpanda"]);
  assert.deepEqual(keys("lodge_manager", true, false), ["reporting", "sop"]);
  assert.equal(moduleForPath("/red-panda/new", "sales_member"), "redpanda");
  assert.equal(moduleForPath("/sales/queries", "super_admin"), "sales");
  const rp = NAV.filter((g) => g.module === "redpanda").flatMap((g) => g.items);
  assert.deepEqual(rp.filter((i) => i.roles).map((i) => [i.href, i.roles]), [["/red-panda/master", ["super_admin"]], ["/red-panda/access", ["super_admin"]]]);
  // sales-only accounts may open /red-panda (the pages check access)
  assert.match(src("middleware.ts"), /SALES_MEMBER_PATHS = \[[^\]]*"\/red-panda"/);
});

test("every Red Panda page checks access on the server; Master data and access: the editor", () => {
  const dir = join(ROOT, "app", "(dashboard)", "red-panda");
  const pages: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f === "page.tsx" && pages.push(join(d, f))));
  walk(dir);
  assert.ok(pages.length >= 5);
  for (const p of pages) {
    const s = readFileSync(p, "utf8");
    const rel = relative(dir, p).split("\\").join("/"); // Windows paths use a backslash
    if (/^(master|access)\//.test(rel)) assert.match(s, /await requireRpEditor\(\)/, rel);
    else assert.match(s, /await requireRpUser\(\)/, rel);
  }
  // every exported server action checks the caller first
  const actions = src("app/(dashboard)/red-panda/actions.ts") + "\n" + src("app/(dashboard)/red-panda/ai-actions.ts");
  const fns = [...actions.replace(/\r/g, "").matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
  assert.ok(fns.length >= 10);
  // the assistant: names, emails and phones are taken out before the AI; the evidence rule checks its answer
  assert.match(src("app/(dashboard)/red-panda/ai-actions.ts"), /scrubRp\(message[\s\S]*checkRpEvidence\(/);
  for (const [, name, body] of fns) assert.match(body, /await (guard|editor)\(\)/, `${name}() does not check the caller`);
  // the service role is used only on the server
  for (const f of ["components/redpanda/builder.tsx", "components/redpanda/master-editor.tsx", "components/redpanda/access-editor.tsx"]) assert.doesNotMatch(src(f), /supabase\/admin/);
});

// ------------------------------------------------------------------ guest text and page

test("guest text: dated days with the year, the airports and hours filled in, the Mayfair nights", () => {
  const p = plan({ hotel_before: { nights: 1, room_id: "R_jungle" } });
  const price = priceRedPanda(p, MASTER);
  assert.deepEqual(price.errors, []);
  const c = rpGuestContent(p, price, SETTINGS);
  assert.equal(c.days.length, 7); // 1 hotel night + 5 nights at the Outpost + the day they leave
  assert.equal(c.days[0].dateText, "Fri, 20 Nov 2026");
  assert.match(c.days[0].title, /Mayfair Chumta/);
  assert.equal(c.days[1].dateText, "Sat, 21 Nov 2026");
  assert.match(c.days[1].text, /Bagdogra Airport/);
  assert.match(c.days[1].text, /about a 5-hour journey/);
  assert.equal(c.days[6].dateText, "Thu, 26 Nov 2026");
  assert.match(c.days[6].title, /Departure/);
  for (const d of c.days) assert.doesNotMatch(d.text + d.title, /\{\w+\}/);
  assert.ok(c.inclusions.some((x) => /Stay for 5 nights \/ 6 days/.test(x)));
  assert.ok(c.inclusions.some((x) => /4-day Red Panda Expedition/.test(x)));
  assert.ok(c.inclusions.some((x) => /Mayfair Chumta, Jungle View Room \(AP\), 1 night on arrival/.test(x)));
  assert.equal(c.paymentTerms, "For confirmation: 50% deposit at the time of booking and the balance 50% 45 days prior to departure.");
  assert.ok(c.glance.some((g) => g.label === "Dates" && g.value === "Fri, 20 Nov 2026 to Thu, 26 Nov 2026"));
  // Bhadrapur: 3.5 hours, no border wording on the glance
  const b = rpGuestContent(plan({ arrive_airport: "BDP", depart_airport: "BDP" }), priceRedPanda(plan({ arrive_airport: "BDP", depart_airport: "BDP" }), MASTER), SETTINGS);
  assert.match(b.days[0].text, /Bhadrapur.*about a 3.5-hour journey/);
  assert.equal(b.glance.find((g) => g.label === "Drive to the Outpost")?.value, "About 3.5 hours");
});

function sampleView(): RpClientView {
  const p = plan({ markup_pct: 10, discount: 5000, adjustment: { amount: -500, reason: "SECRET-REASON" }, notes: "SECRET-NOTE" });
  const price = priceRedPanda(p, MASTER);
  return {
    queryNo: "PS-2026-0101",
    versionNo: 1,
    guestName: "Ann Hill",
    content: rpGuestContent(p, price, SETTINGS),
    total: price.totals.grand,
    perPerson: price.perPerson,
    breakup: guestBreakup(price),
    payments: price.payments,
    quotedOn: "2026-11-05",
    validUntil: "2026-11-20",
    cover: "https://x.supabase.co/storage/v1/object/public/sales-media/red-panda/1-abcdef12.jpg",
    photos: [{ url: "https://x.supabase.co/storage/v1/object/public/sales-media/red-panda/2-abcdef12.jpg", caption: "The old wooden house" }],
    cancellation: ["60 days or more before arrival: 10% of the total"],
    consultant: { name: "Naveen", phone: "+91 98100 00000", email: "naveen@example.com" },
    emergency: null,
    directContacts: ["enquiry@pugdundeesafaris.com"],
    whatsapp: "https://wa.me/919810000000",
    company: { name: "Pugdundee Safaris", email: "", phone: "" },
  };
}

test("the guest page renders: cover with the name, at a glance, days, stay, price with GST, terms, contacts, WhatsApp", () => {
  const v = sampleView();
  (globalThis as { React?: unknown }).React = React; // the test runner compiles JSX to React.createElement
  const html = renderToStaticMarkup(createElement(RedPandaGuestPage, { view: v }));
  for (const s of ["Ann Hill", "Red Panda Outpost", "In search of the red panda", "Your journey at a glance", "Day 1", "Fri, 20 Nov 2026", "Day 6", "The old wooden house", "GST included", "What the price includes", "What it does not include", "Good to know", "Cancellation", "60 days or more", "Naveen", "wa.me/919810000000", 'data-pdf-block="cover"', "PS-2026-0101", "20 November 2026"])
    assert.ok(html.includes(s), s);
  // the total on the page is the quote's total
  assert.ok(html.includes(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v.total)));
  // nothing internal, and none of the Safari wording
  for (const s of ["SECRET-REASON", "SECRET-NOTE", "Markup", "markup", "Adjustment", "Discount", "safari prepared", "A private safari"]) assert.ok(!html.includes(s), s);
});

// ------------------------------------------------------------------ payments

test("booked: the Payments booking has the Outpost and Mayfair lines, extras on the booking, 50/50 dues", () => {
  const p = plan({ hotel_after: { nights: 1, room_id: "R_jungle" }, custom_items: [{ label: "Darjeeling day", amount: 10000, gst_pct: 5 }] });
  const price = priceRedPanda(p, MASTER);
  assert.deepEqual(price.errors, []);
  const d = bookingFromVersion(
    { id: "q1", guest_name: "Ann Hill", assigned_to: null, booked_at: "2026-09-01T10:00:00Z", booked_amount: 100000, payment_ref: "UTR1" },
    { version_no: 2, currency: "INR", plan: p as never, pricing: price as never },
    "2026-09-01"
  );
  assert.deepEqual(
    d.lines.map((l) => [l.lodge_name, l.check_in, l.check_out, l.nights, l.rooms, l.room_amount, l.transfer_amount]),
    [
      ["Red Panda Outpost", "2026-11-20", "2026-11-25", 5, 1, 531300, 0],
      ["Mayfair Chumta", "2026-11-25", "2026-11-26", 1, 1, 20060, 3150], // 1 double 17,000 + 18%,
    ]
  );
  assert.equal(d.booking.other_amount, 10500);
  assert.equal(d.booking.check_in, "2026-11-20");
  assert.equal(d.booking.check_out, "2026-11-26");
  const total = d.lines.reduce((t, l) => t + l.room_amount + l.transfer_amount, 0) + d.booking.other_amount - d.booking.discount_amount;
  assert.equal(total, price.totals.grand);
  assert.deepEqual(d.dues.map((x) => [x.label, x.due_on, x.amount]), [["Deposit", "2026-09-01", price.payments[0].amount], ["Balance", "2026-10-06", price.payments[1].amount]]);
  assert.equal(d.payment?.amount, 100000);
});

// ------------------------------------------------------------------ Master data checks

test("Master data: money is a number 0 or more; settings fields are checked, problems listed", () => {
  assert.equal(checkMoneyInput("2,53,000"), 253000);
  assert.equal(checkMoneyInput("Rs 500"), 500);
  assert.equal(checkMoneyInput("-1"), null);
  assert.equal(checkMoneyInput("abc"), null);
  assert.equal(checkMoneyInput(""), null);
  const ok = checkSettingsInput({ gst_pct: 5, min_nights: 4, max_nights: 10, airports: [{ code: "IXB", name: "Bagdogra", hours: 5 }], inclusions: "a\n\nb", days: SETTINGS.days });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.data.inclusions, ["a", "b"]);
  const bad = checkSettingsInput({ gst_pct: 50, min_nights: 6, max_nights: 5, airports: [{ code: "IXB", name: "", hours: 0 }], days: [{ title: "x", text: "" }] });
  assert.equal(bad.problems.length, 4);
});

// ------------------------------------------------------------------ never in Safari logic

test("a Red Panda quote never reaches the Safari pricing engine, planner, reader or guest page", () => {
  const rp = { ...plan(), kind: "red_panda" };
  assert.equal(isRedPandaPlan(rp), true);
  assert.equal(isRedPandaPlan({ stops: [] }), false);
  // the Safari plan check refuses it (no arrival date / stops): it is never priced as a safari
  assert.equal(sanitizePlan(rp), null);
  // the doors: the Safari builder, the Safari query page and the Safari guest view send it away
  assert.match(src("app/(dashboard)/sales/new/page.tsx"), /isRedPandaPlan\([\s\S]*?\)\) redirect\(`\/red-panda\/new\?from=/);
  assert.match(src("app/(dashboard)/sales/queries/[id]/page.tsx"), /query_type === "red_panda"\) redirect\(`\/red-panda\/quotes\//);
  const cv = src("lib/sales/client-view.ts");
  assert.ok(cv.indexOf('kind === "red_panda") return null') < cv.indexOf("plan.stops.map"), "loadClientView returns before reading Safari stops");
  // Red Panda code never imports the Safari engine, planner, reader or AI
  const dirs = ["lib/redpanda", "components/redpanda", "app/(dashboard)/red-panda"];
  for (const d of dirs) {
    const walk = (x: string): string[] => readdirSync(join(ROOT, x)).flatMap((f) => (statSync(join(ROOT, x, f)).isDirectory() ? walk(join(x, f)) : /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) ? [join(x, f)] : []));
    for (const f of walk(d)) assert.doesNotMatch(src(f), /lib\/sales\/(pricing\/engine|plan\/(planner|parse-text|chat|ai|reading|sanitize))/, f);
  }
  // and the Safari engine / reader never import Red Panda code
  for (const f of ["lib/sales/pricing/engine.ts", "lib/sales/plan/planner.ts", "lib/sales/plan/parse-text.ts", "lib/sales/plan/sanitize.ts"]) assert.doesNotMatch(src(f), /redpanda/, f);
  // the browser's plan is checked field by field
  assert.equal(sanitizeRpPlan({ kind: "red_panda", guest: { adults: 2 } }).guest.adults, 2);
});
