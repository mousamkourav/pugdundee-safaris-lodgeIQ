// The Red Panda Outpost price. Pure (no database, no clock): tested in pricing.test.ts.
//
// From Red_Panda_Tariff_Sheet.xlsx and the owner's answers (5 Nov 2026):
// - the tariff is per person for the 5-night package (airport to airport), by the number of guests
//   travelling together (1 - 10), the year (Oct - May) and the market: an agent = B2B; a direct
//   guest = B2C, foreign or Indian by nationality. A rate can be typed by hand for a case.
// - the room set-up is in the tariff: 2 per room, the odd guest in a single (3 = 1 single + 1 double).
//   Each room more than that = one single room supplement.
// - a tour leader is charged for up to 3 paid guests; complimentary from 4.
// - minimum 5 nights, sometimes 4; other nights than 5 = pro rata (nights / 5) on the package,
//   the supplements and the tour leader.
// - guests from 16 years at the full tariff; younger = not possible.
// - GST 5% on the package (after markup and discount). The partner hotel near Bagdogra (Mayfair)
//   and its airport transfer: from Sales Master data, with their own tax. Adjustment last.
// - closed June - September (monsoon).
// - payment: 50% at booking, 50% 45 days before arrival.
import type { ISODate, Market, RpLine, RpMaster, RpPlan, RpPrice, RpHotelRate } from "./types";

const DAY = 86_400_000;
export const addDays = (d: ISODate, n: number): ISODate => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isDate = (d: unknown): d is ISODate => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const rupees = (n: number) => Math.round(n);
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const inr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;
const MONTH = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function marketFor(plan: Pick<RpPlan, "guest">): Market {
  if (plan.guest.booked_by === "agent") return "b2b";
  return plan.guest.nationality === "indian" ? "indian" : "foreign";
}
export const MARKET_LABEL: Record<Market, string> = { b2b: "B2B (agent)", foreign: "B2C foreign", indian: "B2C Indian" };

export const guestCount = (plan: Pick<RpPlan, "guest">) => Math.max(0, Math.floor(num(plan.guest.adults))) + (plan.guest.child_ages ?? []).length;
export const standardRooms = (guests: number) => Math.ceil(guests / 2);

// The dates: the day they land, the Outpost's nights, the day they fly out.
export function tripDates(plan: Pick<RpPlan, "arrival" | "nights" | "hotel_before" | "hotel_after">) {
  if (!isDate(plan.arrival)) return { arrival: null, check_in: null, check_out: null, departure: null };
  const before = Math.max(0, Math.floor(num(plan.hotel_before?.nights)));
  const after = Math.max(0, Math.floor(num(plan.hotel_after?.nights)));
  const check_in = addDays(plan.arrival, before);
  const check_out = addDays(check_in, Math.max(0, Math.floor(num(plan.nights))));
  return { arrival: plan.arrival, check_in, check_out, departure: addDays(check_out, after) };
}

function hotelRateOn(rates: RpHotelRate[], d: ISODate): RpHotelRate | null {
  return rates.find((r) => r.valid_from <= d && d <= r.valid_to) ?? null;
}

export function priceRedPanda(plan: RpPlan, m: RpMaster): RpPrice {
  const s = m.settings;
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: RpLine[] = [];
  const market = marketFor(plan);
  const guests = guestCount(plan);
  const nights = Math.floor(num(plan.nights));
  const dates = tripDates(plan);

  // ---- who
  if (guests < 1) errors.push("Add the guests (at least 1 adult).");
  if (guests > s.max_guests) errors.push(`Red Panda Outpost takes up to ${s.max_guests} guests (this quote has ${guests}).`);
  for (const a of plan.guest.child_ages ?? []) {
    if (!Number.isFinite(a) || a < s.min_age) errors.push(`Guests must be ${s.min_age} years or older (a child of ${Number.isFinite(a) ? a : "?"} is in the quote).`);
  }
  const std = standardRooms(guests);
  const rooms = plan.guest.rooms == null ? std : Math.floor(num(plan.guest.rooms));
  if (guests >= 1) {
    if (rooms < std) errors.push(`${guests} guests need at least ${std} room${std === 1 ? "" : "s"} (2 per room, twin beds).`);
    if (rooms > Math.min(guests, s.max_rooms)) errors.push(`At most ${Math.min(guests, s.max_rooms)} room${Math.min(guests, s.max_rooms) === 1 ? "" : "s"} for ${guests} guest${guests === 1 ? "" : "s"} (the Outpost has ${s.max_rooms}).`);
  }
  const singles = Math.max(0, 2 * rooms - guests);
  const extraRooms = Math.max(0, rooms - std);

  // ---- when
  if (nights < s.min_nights) errors.push(`At least ${s.min_nights} nights (the package is ${s.package_nights}).`);
  else if (nights > s.max_nights) errors.push(`At most ${s.max_nights} nights.`);
  else if (nights < s.package_nights) warnings.push(`${nights} nights: shorter than the ${s.package_nights}-night package, priced pro rata. Check with the team that it is possible.`);
  if (!dates.check_in) errors.push("Add the arrival date.");
  const nightDates: ISODate[] = [];
  if (dates.check_in) for (let i = 0; i < Math.max(0, nights); i++) nightDates.push(addDays(dates.check_in, i));
  const closed = nightDates.filter((d) => s.closed_months.includes(Number(d.slice(5, 7))));
  if (closed.length) {
    const months = [...new Set(closed.map((d) => MONTH[Number(d.slice(5, 7))]))].join(", ");
    errors.push(`Red Panda Outpost is closed in ${months} (monsoon, June to September).`);
  }

  // ---- the tariff row
  const first = nightDates[0];
  const last = nightDates[nightDates.length - 1];
  const g = Math.min(Math.max(guests, 1), 10);
  const row = first ? m.tariff.find((t) => t.active && t.market === market && t.guests === g && t.valid_from <= first && last <= t.valid_to) ?? null : null;
  const season = row?.season ?? null;
  const supp = (kind: "single_room" | "tour_leader") =>
    first ? m.supplements.find((x) => x.active && x.market === market && x.kind === kind && x.valid_from <= first && last <= x.valid_to) ?? null : null;
  if (first && !closed.length && !row && plan.per_pax_override == null)
    errors.push(`No Red Panda tariff in Master data for ${MARKET_LABEL[market]}, ${g} guest${g === 1 ? "" : "s"}, on these dates.`);

  const override = plan.per_pax_override != null && Number.isFinite(plan.per_pax_override) ? plan.per_pax_override : null;
  if (override != null && override < 0) errors.push("The typed rate cannot be below 0.");
  const perPax = override != null ? Math.max(0, override) : row?.per_pax ?? 0;
  if (override != null && row && override !== row.per_pax) warnings.push(`Rate typed by hand: ${inr(override)} per person (the tariff says ${inr(row.per_pax)}).`);
  const pro = s.package_nights > 0 ? nights / s.package_nights : 1;
  const proText = nights === s.package_nights ? "" : ` x ${nights}/${s.package_nights} nights`;
  const gst = num(s.gst_pct);

  // ---- the package
  if (guests >= 1) {
    lines.push({
      key: "package",
      label: `Red Panda Outpost, ${nights} nights / ${nights + 1} days`,
      detail: `${inr(perPax)} per person x ${guests} guest${guests === 1 ? "" : "s"}${proText} (${MARKET_LABEL[market]}${season ? `, ${season}` : ""})`,
      amount: rupees(perPax * guests * pro),
      gst_pct: gst,
      gst: 0,
      group: "package",
    });
  }
  if (extraRooms > 0) {
    const sr = supp("single_room");
    if (!sr) errors.push("No single room supplement in Master data for these dates.");
    else
      lines.push({
        key: "single_room",
        label: "Single room supplement",
        detail: `${inr(sr.amount)} x ${extraRooms} room${extraRooms === 1 ? "" : "s"} more than the standard ${std}${proText}`,
        amount: rupees(sr.amount * extraRooms * pro),
        gst_pct: gst,
        gst: 0,
        group: "package",
      });
  }
  if (plan.tour_leader && guests >= 1) {
    const tl = supp("tour_leader");
    if (guests >= 4) lines.push({ key: "tour_leader", label: "Tour leader", detail: "Complimentary from 4 paying guests", amount: 0, gst_pct: gst, gst: 0, group: "package" });
    else if (!tl) errors.push("No tour leader rate in Master data for these dates.");
    else lines.push({ key: "tour_leader", label: "Tour leader", detail: `${inr(tl.amount)}${proText} (charged up to 3 paying guests)`, amount: rupees(tl.amount * pro), gst_pct: gst, gst: 0, group: "package" });
  }
  const pkg = lines.reduce((t, l) => t + l.amount, 0);
  const markupPct = num(plan.markup_pct);
  if (markupPct < 0 || markupPct > 100) errors.push("Markup must be between 0 and 100%.");
  const markup = rupees((pkg * Math.min(100, Math.max(0, markupPct))) / 100);
  const discountTyped = num(plan.discount);
  if (discountTyped < 0) errors.push("The discount cannot be below 0.");
  const discount = Math.min(Math.max(0, discountTyped), pkg + markup);
  if (discountTyped > pkg + markup) warnings.push("The discount is more than the package: limited to the package.");
  const pkgGst = rupees(((pkg + markup - discount) * gst) / 100);
  for (const l of lines) l.gst = rupees((l.amount * gst) / 100);

  // ---- the partner hotel near Bagdogra, before and after
  let hotelTotal = 0;
  const stays = [
    { key: "before", h: plan.hotel_before, from: dates.arrival, airport: plan.arrive_airport, when: "on arrival" },
    { key: "after", h: plan.hotel_after, from: dates.check_out, airport: plan.depart_airport, when: "before departure" },
  ];
  for (const st of stays) {
    const n = Math.floor(num(st.h?.nights));
    if (n <= 0) continue;
    if (n > 5) errors.push(`Hotel ${st.when}: at most 5 nights.`);
    if (st.airport !== "IXB") errors.push(`Hotel ${st.when}: the partner hotel is near Bagdogra; the guests ${st.key === "before" ? "arrive" : "leave"} through Bhadrapur.`);
    const hotel = m.hotel;
    if (!hotel) {
      errors.push(`Hotel ${st.when}: no partner hotel "${s.hotel_property}" in Sales Master data.`);
      continue;
    }
    const room = hotel.rooms.find((r) => r.id === st.h.room_id) ?? null;
    if (!room) {
      errors.push(`Hotel ${st.when}: choose the room type at ${hotel.name}.`);
      continue;
    }
    if (!st.from) continue;
    let base = 0;
    let tax = 0;
    let missing = 0;
    let meal = "";
    for (let i = 0; i < n; i++) {
      const d = addDays(st.from, i);
      const r = hotelRateOn(room.rates, d);
      if (!r) {
        missing++;
        continue;
      }
      meal = r.meal_plan;
      const night = (guests - singles) / 2 * r.rate_double + singles * (r.rate_single ?? r.rate_double);
      base += night;
      if (!r.rates_include_tax) tax += (night * num(r.tax_pct)) / 100;
    }
    if (missing) errors.push(`Hotel ${st.when}: ${hotel.name} ${room.name} has no rate in Sales Master data for ${missing} of the ${n} night${n === 1 ? "" : "s"}.`);
    const doubles = (guests - singles) / 2;
    lines.push({
      key: `hotel_${st.key}`,
      label: `${hotel.name}, ${room.name}${meal ? ` (${meal})` : ""}, ${n} night${n === 1 ? "" : "s"} ${st.when}`,
      detail: [doubles ? `${doubles} double` : "", singles ? `${singles} single` : ""].filter(Boolean).join(" + ") + ` room${rooms === 1 ? "" : "s"}`,
      amount: rupees(base),
      gst_pct: base ? rupees((tax / base) * 10000) / 100 : 0,
      gst: rupees(tax),
      group: "hotel",
    });
    hotelTotal += rupees(base) + rupees(tax);
    // Bagdogra Airport <> hotel (the Outpost transfer picks up from / drops at the hotel)
    const t = hotel.transfer;
    const on = st.key === "before" ? st.from : addDays(st.from, n);
    if (!t || (t.valid_from && on < t.valid_from) || (t.valid_to && on > t.valid_to)) errors.push(`Hotel ${st.when}: no Bagdogra Airport - ${hotel.name} transfer rate in Sales Master data.`);
    else {
      const vehicles = Math.max(1, Math.ceil(guests / Math.max(1, t.capacity)));
      const amt = rupees(t.rate * vehicles);
      const tx = rupees((amt * num(t.tax_pct)) / 100);
      lines.push({
        key: `hotel_${st.key}_transfer`,
        label: st.key === "before" ? `Transfer Bagdogra Airport to ${hotel.name}` : `Transfer ${hotel.name} to Bagdogra Airport`,
        detail: `${inr(t.rate)} x ${vehicles} ${t.vehicle_type}`,
        amount: amt,
        gst_pct: num(t.tax_pct),
        gst: tx,
        group: "hotel",
      });
      hotelTotal += amt + tx;
    }
  }

  // ---- items typed by hand
  let extras = 0;
  (plan.custom_items ?? []).forEach((c, i) => {
    const a = num(c.amount);
    const p = num(c.gst_pct);
    if (!c.label?.trim()) errors.push(`Extra item ${i + 1}: add a name.`);
    if (a < 0) errors.push(`Extra item "${c.label || i + 1}": the amount cannot be below 0.`);
    if (p < 0 || p > 28) errors.push(`Extra item "${c.label || i + 1}": GST must be between 0 and 28%.`);
    const amount = rupees(Math.max(0, a));
    const tax = rupees((amount * Math.max(0, p)) / 100);
    lines.push({ key: `extra_${i}`, label: c.label?.trim() || "Extra", detail: "Typed by hand", amount, gst_pct: p, gst: tax, group: "extra" });
    extras += amount + tax;
  });

  const adjustment = rupees(num(plan.adjustment?.amount));
  if (adjustment !== 0 && !plan.adjustment?.reason?.trim()) errors.push("Give the reason for the adjustment.");
  let grand = pkg + markup - discount + pkgGst + hotelTotal + extras + adjustment;
  if (grand < 0) {
    errors.push("The total cannot be below 0 (check the adjustment).");
    grand = 0;
  }

  // ---- payment terms
  const dep = num(s.deposit_pct);
  const deposit = rupees((grand * dep) / 100);
  const balanceDue = dates.arrival ? addDays(dates.arrival, -num(s.balance_days_before)) : null;
  const payments = grand > 0
    ? [
        { label: "Deposit", pct: dep, due: null, amount: deposit, note: "at booking" },
        { label: "Balance", pct: 100 - dep, due: balanceDue, amount: grand - deposit, note: `${num(s.balance_days_before)} days before arrival` },
      ]
    : [];

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    season,
    market,
    guests,
    rooms,
    singles,
    per_pax: perPax,
    pro_rata: pro,
    lines,
    totals: { package: pkg, markup, discount, package_gst: pkgGst, hotel: hotelTotal, extras, adjustment, grand },
    perPerson: guests ? rupees(grand / guests) : 0,
    arrival: dates.arrival,
    departure: dates.departure,
    outpost: { check_in: dates.check_in, check_out: dates.check_out },
    currency: "INR",
    payments,
  };
}

// What the guest sees per line (no markup, discount or adjustment shown apart): the package with
// markup and discount spread into it, GST, the hotel, extras. Totals match the grand total.
export function guestBreakup(p: RpPrice): { label: string; amount: number }[] {
  const out: { label: string; amount: number }[] = [];
  const pkgNet = p.totals.package + p.totals.markup - p.totals.discount;
  const pkgLabel = p.lines.find((l) => l.key === "package")?.label ?? "Red Panda Outpost package";
  const extrasIn = p.lines.filter((l) => l.group === "package" && l.key !== "package" && l.amount > 0).map((l) => l.label.toLowerCase());
  if (pkgNet) out.push({ label: extrasIn.length ? `${pkgLabel} (incl. ${extrasIn.join(", ")})` : pkgLabel, amount: pkgNet });
  if (p.totals.package_gst) out.push({ label: "GST on the package", amount: p.totals.package_gst });
  for (const l of p.lines.filter((x) => x.group !== "package")) out.push({ label: l.label, amount: l.amount + l.gst });
  if (p.totals.adjustment) {
    // an adjustment is folded into the package line (the reason is internal)
    if (out.length) out[0] = { ...out[0], amount: out[0].amount + p.totals.adjustment };
    else out.push({ label: pkgLabel, amount: p.totals.adjustment });
  }
  return out;
}
