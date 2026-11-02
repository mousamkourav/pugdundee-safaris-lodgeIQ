// =====================================================================
// Rate coverage: every price a quote on our circuit can need, checked by pricing it with the
// real engine (priceTrip). Whatever comes back "price needed" (or priced at 0 by mistake) is
// listed, month by month, so Master data can be completed once instead of the sales team
// typing prices in each quote.
//   - Accommodation: every room of every lodge and hotel, Indian and foreign guests, each month
//     ahead; and a child of 8 (a hotel with no child rate charges nothing)
//   - Safaris: each park with a lodge: core morning and evening (buffer when the park has buffer
//     rates), booked 30 and 90 days ahead (Tadoba's booking windows), Indian and foreign
//   - Full-day safari: each park (a full-day rate, or a lodge's full-day add-on)
//   - Naturalist: each park (on the safari rate, or a naturalist add-on)
//   - Activities: add-ons with no price
// Transfers are the "Missing transfer rates" list (missing-transfers.ts).
// Pure, so it is tested without a database.
// =====================================================================
import { priceTrip } from "@/lib/sales/pricing/engine";
import { addDays } from "@/lib/sales/pricing/dates";
import type { ISODate, PricingData, SafariInput, StayInput, TripInput } from "@/lib/sales/pricing/types";
import { cityParkIds, isCityHotel } from "@/lib/sales/plan/cities";
import { EXTRA_WORDS } from "@/lib/sales/plan/parse-text";

export type CoverageArea = "Accommodation" | "Child rate" | "Safari" | "Full-day safari" | "Naturalist" | "Activity";
export interface CoverageIssue {
  area: CoverageArea;
  item: string; // "Kanha Earth Lodge - Cottage (foreign guests)"
  detail: string; // "no rate for Jul 2027 - Sep 2027"
  href?: string; // where to fix it in Master data
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (iso: ISODate) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// the 15th of each month ahead (from next month when the 15th has passed)
export function sampleDates(today: ISODate, months: number): ISODate[] {
  const [y, m, d] = today.split("-").map(Number);
  const start = d > 15 ? m : m - 1; // 0-based month index of the first sample
  return Array.from({ length: months }, (_, i) => {
    const t = new Date(Date.UTC(y, start + i, 15));
    return t.toISOString().slice(0, 10);
  });
}

// "Jul 2027 - Sep 2027, Dec 2027": months in runs
function monthRuns(dates: ISODate[], all: ISODate[]): string {
  const idx = dates.map((x) => all.indexOf(x)).sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs.map(([a, b]) => (a === b ? monthName(all[a]) : `${monthName(all[a])} - ${monthName(all[b])}`)).join(", ");
}

// Months to check: to the end of the season being sold (30 September; from April on, the next
// season's too, as quotes for it start coming in).
export function seasonMonths(today: ISODate): number {
  const [y, m] = today.split("-").map(Number);
  const endYear = m >= 4 ? y + 1 : y;
  return (endYear - y) * 12 + (9 - m) + 1;
}

export function rateCoverage(d: PricingData, today: ISODate, months = seasonMonths(today)): CoverageIssue[] {
  const out: CoverageIssue[] = [];
  const dates = sampleDates(today, months);
  const cities = cityParkIds({ properties: d.properties, pricing: d });
  const parkName = (id: string | null) => d.parks.find((p) => p.id === id)?.name ?? "the park";
  const base = (o: Partial<TripInput>): TripInput => ({ adults: 2, children: [], nationality: "foreign", stays: [], safaris: [], transfers: [], booking_date: today, ...o });
  const nationalities = ["indian", "foreign"] as const;

  // ---- accommodation, and a child's rate
  for (const p of d.properties) {
    const city = isCityHotel(p, cities);
    for (const room of d.rooms.filter((r) => r.property_id === p.id)) {
      const plans = [...new Set(d.roomRates.filter((x) => x.room_category_id === room.id && x.active !== false).map((x) => x.meal_plan))];
      const meal = plans.includes("AP") ? "AP" : plans[0] ?? (city ? "CP" : "AP");
      const stay = (date: ISODate): StayInput => ({ property_id: p.id, room_category_id: room.id, meal_plan: meal, check_in: date, nights: 1, rooms: 1, ...(city ? { outside: true } : {}) });
      const href = `/sales/admin/room-rates?f_room_category_id=${room.id}`;
      let priced: ISODate | null = null;
      for (const nat of nationalities) {
        const gaps = dates.filter((date) => {
          const r = priceTrip(base({ nationality: nat, stays: [stay(date)] }), d);
          const missing = r.missing.some((m) => m.kind === "room") || r.errors.length > 0;
          if (!missing && !priced) priced = date;
          return missing;
        });
        if (gaps.length) {
          out.push({
            area: "Accommodation",
            item: `${p.name} - ${room.name} (${nat === "indian" ? "Indian" : "foreign"} guests)`,
            detail: gaps.length === dates.length ? "no rate at all" : `no rate for ${monthRuns(gaps, dates)}`,
            href,
          });
        }
      }
      // a child of 8 sharing the room, on a night that has a rate
      if (priced && (room.max_children ?? 1) > 0) {
        const r = priceTrip(base({ children: [8], stays: [stay(priced)] }), d);
        if (r.warnings.some((w) => /no child rate/i.test(w))) {
          out.push({ area: "Child rate", item: `${p.name} - ${room.name}`, detail: "no child rate for a child of 8: the child is charged nothing", href });
        }
      }
    }
  }

  // ---- safaris, full-day, naturalist: every park with a lodge (not a city)
  const parks = d.parks.filter((pk) => !cities.has(pk.id) && d.properties.some((p) => p.park_id === pk.id && !isCityHotel(p, cities)));
  for (const pk of parks) {
    const lodge = d.properties.find((p) => p.park_id === pk.id && !isCityHotel(p, cities))!;
    const room = d.rooms.find((r) => r.property_id === lodge.id);
    const hasBuffer = d.safariRates.some((r) => r.park_id === pk.id && r.zone === "buffer" && r.active !== false);
    const kinds: { zone: "core" | "buffer"; session: SafariInput["session"]; area: CoverageArea; label: string }[] = [
      { zone: "core", session: "morning", area: "Safari", label: "core morning safari" },
      { zone: "core", session: "afternoon", area: "Safari", label: "core evening safari" },
      ...(hasBuffer
        ? [
            { zone: "buffer" as const, session: "morning" as const, area: "Safari" as const, label: "buffer morning safari" },
            { zone: "buffer" as const, session: "afternoon" as const, area: "Safari" as const, label: "buffer evening safari" },
          ]
        : []),
      { zone: "core", session: "full_day", area: "Full-day safari", label: "full-day safari" },
    ];
    // the night at the lodge that day, so lodge add-ons (full-day safari, naturalist) are found
    const stayAt = (date: ISODate): StayInput[] => (room ? [{ property_id: lodge.id, room_category_id: room.id, meal_plan: "AP", check_in: date, nights: 1, rooms: 1 }] : []);
    for (const k of kinds) {
      for (const nat of nationalities) {
        const gaps = dates.filter((date) =>
          [30, 90].some((lead) => {
            const r = priceTrip(base({ nationality: nat, booking_date: addDays(date, -lead), stays: stayAt(date), safaris: [{ date, park_id: pk.id, zone: k.zone, session: k.session }] }), d);
            return r.missing.some((m) => m.kind === "safari");
          })
        );
        if (gaps.length) {
          out.push({
            area: k.area,
            item: `${parkName(pk.id)}: ${k.label} (${nat === "indian" ? "Indian" : "foreign"} guests)`,
            detail: gaps.length === dates.length ? (k.session === "full_day" ? "no rate and no full-day add-on at a lodge here" : "no rate at all") : `no rate for ${monthRuns(gaps, dates)}`,
            href: k.session === "full_day" && gaps.length === dates.length ? "/sales/admin/addons" : "/sales/admin/safari-rates",
          });
        }
      }
    }
    // a naturalist on a core morning safari
    const nat = dates.find((date) => {
      const r = priceTrip(base({ stays: stayAt(date), safaris: [{ date, park_id: pk.id, zone: "core", session: "morning", naturalist: true }] }), d);
      return r.missing.some((m) => m.kind === "naturalist");
    });
    if (nat) out.push({ area: "Naturalist", item: parkName(pk.id), detail: "no naturalist fee on the safari rate and no naturalist add-on", href: "/sales/admin/addons" });
  }

  // ---- experiences the assistant understands in an enquiry but no lodge has as an add-on: a quote
  // that asks for one gets a price to type (special dinner, bird watching...)
  const norm = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const kw of [...new Set(EXTRA_WORDS.map(([, k]) => k))]) {
    if (kw === "full-day safari" || kw === "fishing") continue; // the full day is a safari (above); fishing is half / full day
    const words = kw.split(/[\s-]+/);
    const has = d.addons.some((a) => a.active !== false && !a.alias && words.every((w) => norm(a.name).includes(` ${w}`)));
    if (!has) out.push({ area: "Activity", item: kw.replace(/^\w/, (c) => c.toUpperCase()), detail: "understood in enquiries, but no add-on in Master data: quotes ask for its price", href: "/sales/admin/addons" });
  }

  // ---- activities with no price
  for (const a of d.addons.filter((x) => x.active !== false && !x.alias)) {
    const tiers = (a.tiers ?? []).some((t) => t.rate > 0);
    if (!(a.rate > 0) && !tiers && !(a.rate_foreign && a.rate_foreign > 0)) {
      const where = d.properties.find((p) => p.id === a.property_id)?.name ?? (a.park_id ? parkName(a.park_id) : "all lodges");
      out.push({ area: "Activity", item: `${a.name} (${where})`, detail: "no price", href: `/sales/admin/addons` });
    }
  }
  // one line for Indian and foreign guests when both miss the same
  const merged: CoverageIssue[] = [];
  for (const i of out) {
    const m = i.item.match(/^(.*) \((Indian|foreign) guests\)$/);
    const twin = m && merged.find((x) => x.item === `${m[1]} (Indian guests)` && x.detail === i.detail && m[2] === "foreign");
    if (twin) twin.item = `${m![1]} (Indian and foreign guests)`;
    else merged.push({ ...i });
  }
  return merged;
}
