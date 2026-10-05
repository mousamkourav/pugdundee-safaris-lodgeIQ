// =====================================================================
// Pricing engine. priceTrip(trip, data) -> PriceResult.
//
// Pure function: everything it needs comes in as arguments, so the same
// trip and master data always give the same price. Checked against the
// Tadoba - Pench costing sheet in pricing.test.ts.
//
// Rules (from the costing sheet and the sales team):
// - Room rates are per room per night. Guests are spread evenly over rooms;
//   1 guest in a room = single rate, 2 = double, more = double + extra adult.
// - A safari rate is per vehicle per session (or per seat); enough vehicles
//   are added for all guests.
// - Transfers are one-way per vehicle; a rate marked "same for return" also
//   prices the reverse trip.
// - Offers discount only what they apply to (rooms by default); safaris and
//   transfers are never discounted unless the offer says so.
// - Each line is billed to a lodge: rooms and safaris to the lodge of that
//   night; transfers to the lodge being left, else the lodge being reached.
// - Payment instalments whose due date has already passed are merged into
//   the deposit at booking.
// =====================================================================

import { addDays, dayName, inRange, nightsOf, weekday } from "./dates";
import type {
  Instalment,
  ISODate,
  Offer,
  PaymentSlab,
  PriceLine,
  PriceResult,
  PricingData,
  PropertyTotals,
  RoomRate,
  SafariInput,
  SafariRate,
  TransferRate,
  TripInput,
} from "./types";

const round = (n: number) => Math.round(n);

export const DEFAULT_PAYMENT_SLABS: PaymentSlab[] = [
  { label: "Deposit", pct: 25, days_before_arrival: null },
  { label: "Second deposit", pct: 25, days_before_arrival: 145 },
  { label: "Final balance", pct: 50, days_before_arrival: 45 },
];

function withTax(base: number, taxPct: number, included: boolean) {
  if (included || !taxPct) return { amount: round(base), tax: 0 };
  const tax = round((base * taxPct) / 100);
  return { amount: round(base) + tax, tax };
}

// Guests spread as evenly as possible: 5 adults in 2 rooms -> [3, 2].
export function occupancy(adults: number, rooms: number): number[] {
  const r = Math.max(1, rooms);
  return Array.from({ length: r }, (_, i) => Math.floor(adults / r) + (i < adults % r ? 1 : 0));
}

function pickRoomRate(rates: RoomRate[], roomId: string, meal: string, night: ISODate) {
  return rates
    .filter((r) => r.active && r.room_category_id === roomId && r.meal_plan === meal && inRange(night, r.valid_from, r.valid_to))
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0]; // most recent start wins
}

function pickSafariRate(rates: SafariRate[], s: SafariInput, nationality: string) {
  const vehicle = s.vehicle_type ?? "exclusive_jeep";
  return rates
    .filter(
      (r) =>
        r.active &&
        r.park_id === s.park_id &&
        r.zone === s.zone &&
        r.session === s.session &&
        r.vehicle_type === vehicle &&
        (r.nationality === "all" || r.nationality === nationality) &&
        inRange(s.date, r.valid_from, r.valid_to)
    )
    .sort((a, b) => {
      // a rate for this nationality beats an "all guests" rate, then newest first
      const na = a.nationality === "all" ? 1 : 0;
      const nb = b.nationality === "all" ? 1 : 0;
      return na - nb || (a.valid_from < b.valid_from ? 1 : -1);
    })[0];
}

export function closureFor(data: PricingData, parkId: string, zone: string, session: string, date: ISODate) {
  const dow = weekday(date);
  return data.closures.find((c) => {
    if (c.park_id !== parkId) return false;
    if (c.zone !== "all" && c.zone !== zone) return false;
    if (c.session !== "full_day" && session !== "full_day" && c.session !== session) return false;
    if (c.closure_type === "weekly") return c.weekday === dow;
    return inRange(date, c.date_from, c.date_to);
  });
}

export function priceTrip(trip: TripInput, data: PricingData): PriceResult {
  const lines: PriceLine[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const guests = trip.adults + trip.children.length;

  const propName = (id: string | null) => data.properties.find((p) => p.id === id)?.name ?? "Other";
  const roomOf = (id: string) => data.rooms.find((r) => r.id === id);
  const parkName = (id: string) => data.parks.find((p) => p.id === id)?.name ?? "park";
  const locOf = (id: string) => data.locations.find((l) => l.id === id);

  if (trip.adults < 1) errors.push("At least one adult is needed.");

  // ---------------- rooms ----------------
  const totalRooms = trip.stays.reduce((m, s) => Math.max(m, s.rooms), 0);
  for (const stay of trip.stays) {
    const room = roomOf(stay.room_category_id);
    const label = `${room?.name ?? "Room"} x${stay.rooms}, ${stay.meal_plan}`;
    const occ = occupancy(trip.adults, stay.rooms);
    if (occ.some((n) => n === 0)) warnings.push(`${propName(stay.property_id)}: more rooms than adults, so some rooms are priced as single.`);
    if (room) {
      const cap = room.max_adults + (room.extra_bed ? 1 : 0);
      if (occ.some((n) => n > cap)) errors.push(`${propName(stay.property_id)}: ${room.name} takes at most ${cap} adults per room. Add rooms.`);
    }

    let minNightsChecked = false;
    for (const night of nightsOf(stay.check_in, stay.nights)) {
      const rate = pickRoomRate(data.roomRates, stay.room_category_id, stay.meal_plan, night);
      if (!rate) {
        errors.push(`No ${stay.meal_plan} rate for ${room?.name ?? "room"} at ${propName(stay.property_id)} on ${night}.`);
        lines.push({ kind: "room", date: night, description: label, quantity: stay.rooms, unit_price: 0, amount: 0, tax: 0, property_id: stay.property_id, ref_id: stay.room_category_id, missing: true });
        continue;
      }
      if (!minNightsChecked && stay.nights < rate.min_nights) {
        warnings.push(`${propName(stay.property_id)} has a minimum stay of ${rate.min_nights} nights for this rate.`);
      }
      minNightsChecked = true;

      const weekend = rate.weekend_days.includes(weekday(night));
      const double = weekend && rate.weekend_rate_double != null ? rate.weekend_rate_double : rate.rate_double;
      const singleRaw = weekend && rate.weekend_rate_single != null ? rate.weekend_rate_single : rate.rate_single;
      const single = singleRaw ?? double;

      let base = 0;
      for (const n of occ) base += n <= 1 ? single : double + Math.max(0, n - 2) * (rate.extra_adult ?? 0);
      for (const age of trip.children) {
        const band = rate.child_rates.find((b) => age >= b.min_age && age <= b.max_age);
        base += band?.rate ?? 0;
      }
      const { amount, tax } = withTax(base, rate.tax_pct, rate.rates_include_tax);
      lines.push({ kind: "room", date: night, description: label, quantity: stay.rooms, unit_price: round(base / stay.rooms), amount, tax, property_id: stay.property_id, ref_id: stay.room_category_id });
    }
  }

  // Which lodge is the guest at on a given date (check-in day to check-out day).
  const stayOn = (date: ISODate) =>
    trip.stays.find((s) => date >= s.check_in && date < addDays(s.check_in, s.nights)) ??
    trip.stays.find((s) => date === addDays(s.check_in, s.nights));

  // ---------------- safaris ----------------
  for (const s of trip.safaris) {
    const where = `${parkName(s.park_id)} ${s.zone} ${s.session.replace("_", " ")} safari`;
    const closed = closureFor(data, s.park_id, s.zone, s.session, s.date);
    if (closed) errors.push(`${where} on ${dayName(s.date)} ${s.date}: park closed${closed.label ? ` (${closed.label})` : ""}.`);

    const rate = pickSafariRate(data.safariRates, s, trip.nationality);
    const billTo = stayOn(s.date)?.property_id ?? null;
    if (!rate) {
      errors.push(`No rate for ${where} on ${s.date}.`);
      lines.push({ kind: "safari", date: s.date, description: where, quantity: 0, unit_price: 0, amount: 0, tax: 0, property_id: billTo, ref_id: s.park_id, missing: true });
      continue;
    }
    const weekend = rate.weekend_days.includes(weekday(s.date));
    const unit = weekend && rate.weekend_rate != null ? rate.weekend_rate : rate.weekday_rate;
    const vehicles = s.vehicles ?? Math.max(1, Math.ceil(guests / Math.max(1, rate.max_pax)));
    const fees = (rate.naturalist_fee + rate.guide_fee) * vehicles;
    const base = rate.pricing_unit === "per_seat" ? unit * guests + fees : unit * vehicles + fees;
    const { amount, tax } = withTax(base, rate.tax_pct, false);
    const qty = rate.pricing_unit === "per_seat" ? guests : vehicles;
    lines.push({ kind: "safari", date: s.date, description: where, quantity: qty, unit_price: unit, amount, tax, property_id: billTo, ref_id: s.park_id });
  }

  // ---------------- transfers ----------------
  for (const t of trip.transfers) {
    const from = locOf(t.from_location_id);
    const to = locOf(t.to_location_id);
    const label = `${from?.name ?? "?"} to ${to?.name ?? "?"}`;
    const billTo = from?.property_id ?? to?.property_id ?? null;

    const candidates = data.transferRates.filter(
      (r) =>
        r.active &&
        inRange(t.date, r.valid_from, r.valid_to) &&
        (!t.vehicle_type || r.vehicle_type.toLowerCase() === t.vehicle_type.toLowerCase()) &&
        ((r.from_location_id === t.from_location_id && r.to_location_id === t.to_location_id) ||
          (r.bidirectional && r.from_location_id === t.to_location_id && r.to_location_id === t.from_location_id))
    );
    const priced = candidates
      .map((r: TransferRate) => {
        const vehicles = t.vehicles ?? Math.max(1, Math.ceil(guests / Math.max(1, r.capacity)));
        const base = vehicles * (r.rate + (t.night ? r.night_surcharge : 0));
        return { r, vehicles, base };
      })
      .sort((a, b) => a.base - b.base)[0];

    if (!priced) {
      errors.push(`No transfer rate for ${label}${t.vehicle_type ? ` by ${t.vehicle_type}` : ""}.`);
      lines.push({ kind: "transfer", date: t.date, description: label, quantity: 0, unit_price: 0, amount: 0, tax: 0, property_id: billTo, ref_id: null, missing: true });
      continue;
    }
    const { amount, tax } = withTax(priced.base, priced.r.tax_pct, false);
    const hours = priced.r.drive_hours ? ` (about ${priced.r.drive_hours} hrs)` : "";
    lines.push({
      kind: "transfer",
      date: t.date,
      description: `${label} by ${priced.r.vehicle_type}${hours}`,
      quantity: priced.vehicles,
      unit_price: priced.r.rate,
      amount,
      tax,
      property_id: billTo,
      ref_id: priced.r.id,
    });
  }

  // ---------------- add-ons ----------------
  for (const a of trip.addons ?? []) {
    const addon = data.addons.find((x) => x.id === a.addon_id && x.active);
    if (!addon) {
      errors.push("An add-on in this trip no longer exists or is inactive.");
      continue;
    }
    const qty =
      a.qty ?? (addon.pricing_unit === "per_person" ? guests : addon.pricing_unit === "per_room" ? Math.max(1, totalRooms) : 1);
    const { amount, tax } = withTax(addon.rate * qty, addon.tax_pct, false);
    lines.push({ kind: "addon", date: a.date ?? null, description: addon.name, quantity: qty, unit_price: addon.rate, amount, tax, property_id: addon.property_id ?? (a.date ? stayOn(a.date)?.property_id ?? null : null), ref_id: addon.id });
  }

  // ---------------- offers ----------------
  const appliedOffers: string[] = [];
  const selected = (trip.offer_ids ?? [])
    .map((id) => data.offers.find((o) => o.id === id))
    .filter((o): o is Offer => !!o);
  if ((trip.offer_ids ?? []).length !== selected.length) warnings.push("A selected offer no longer exists and was skipped.");

  let toApply = selected;
  if (selected.length > 1 && selected.some((o) => !o.combinable)) {
    toApply = [selected[0]];
    warnings.push(`Offers cannot be combined; only "${selected[0].name}" was applied.`);
  }

  const baseLines = lines.filter((l) => !l.missing && l.kind !== "discount");
  for (const offer of toApply) {
    if (!offer.active) {
      warnings.push(`"${offer.name}" is inactive and was not applied.`);
      continue;
    }
    if (!inRange(trip.booking_date, offer.book_from, offer.book_to)) {
      warnings.push(`"${offer.name}" is only for bookings made ${offer.book_from ?? "any time"} to ${offer.book_to ?? "any time"}.`);
      continue;
    }
    const eligibleStays = trip.stays.filter(
      (s) => (!offer.property_ids.length || offer.property_ids.includes(s.property_id)) && (!offer.room_category_ids.length || offer.room_category_ids.includes(s.room_category_id))
    );
    const nights = eligibleStays.reduce((t, s) => t + s.nights, 0);
    if (offer.applies_to.includes("room") && nights < offer.min_nights) {
      warnings.push(`"${offer.name}" needs at least ${offer.min_nights} nights at the eligible lodges.`);
      continue;
    }

    const matches = (l: PriceLine) =>
      offer.applies_to.includes(l.kind) &&
      (!l.date || inRange(l.date, offer.travel_from, offer.travel_to)) &&
      (!offer.property_ids.length || (l.property_id !== null && offer.property_ids.includes(l.property_id))) &&
      (l.kind !== "room" || !offer.room_category_ids.length || (l.ref_id !== null && offer.room_category_ids.includes(l.ref_id)));

    const discountBy = new Map<string | null, number>();
    const add = (pid: string | null, n: number) => discountBy.set(pid, (discountBy.get(pid) ?? 0) + n);

    if (offer.offer_type === "percent") {
      for (const l of baseLines.filter(matches)) add(l.property_id, round((l.amount * (offer.value ?? 0)) / 100));
    } else if (offer.offer_type === "fixed_rate") {
      for (const l of baseLines.filter((x) => x.kind === "room" && matches(x))) {
        const offerAmount = (offer.value ?? 0) * l.quantity;
        if (l.amount > offerAmount) add(l.property_id, l.amount - offerAmount);
      }
    } else if (offer.offer_type === "stay_pay" && offer.stay_nights && offer.pay_nights && offer.stay_nights > offer.pay_nights) {
      for (const s of eligibleStays) {
        const nightLines = baseLines
          .filter((l) => l.kind === "room" && l.property_id === s.property_id && l.ref_id === s.room_category_id && matches(l))
          .sort((a, b) => a.amount - b.amount);
        const free = Math.floor(nightLines.length / offer.stay_nights) * (offer.stay_nights - offer.pay_nights);
        nightLines.slice(0, free).forEach((l) => add(l.property_id, l.amount));
      }
    }

    const total = [...discountBy.values()].reduce((a, b) => a + b, 0);
    if (total <= 0) {
      warnings.push(`"${offer.name}" does not reduce the price of this trip.`);
      continue;
    }
    appliedOffers.push(offer.id);
    for (const [pid, amt] of discountBy) {
      if (amt > 0) lines.push({ kind: "discount", date: null, description: offer.name, quantity: 1, unit_price: -amt, amount: -amt, tax: 0, property_id: pid, ref_id: offer.id });
    }
  }

  // ---------------- totals, markup, adjustment ----------------
  const sum = (k: PriceLine["kind"]) => lines.filter((l) => l.kind === k).reduce((t, l) => t + l.amount, 0);
  const room = sum("room");
  const safari = sum("safari");
  const transfer = sum("transfer");
  const addon = sum("addon");
  const discount = sum("discount");
  const subtotal = room + safari + transfer + addon + discount;

  const markupPct = trip.markup_pct ?? data.settings.markup_pct ?? 0;
  const markup = round((subtotal * markupPct) / 100);
  if (markup) lines.push({ kind: "markup", date: null, description: `Markup ${markupPct}%`, quantity: 1, unit_price: markup, amount: markup, tax: 0, property_id: null, ref_id: null });

  const adjustment = round(trip.adjustment?.amount ?? 0);
  if (adjustment) {
    if (!trip.adjustment?.reason?.trim()) errors.push("A manual adjustment needs a reason.");
    lines.push({ kind: "adjustment", date: null, description: trip.adjustment?.reason?.trim() || "Manual adjustment", quantity: 1, unit_price: adjustment, amount: adjustment, tax: 0, property_id: null, ref_id: null });
  }
  const grand = subtotal + markup + adjustment;
  if (grand < 0) errors.push("The total is below zero. Check the discount and adjustment.");

  // ---------------- per lodge ----------------
  const byPid = new Map<string | null, PropertyTotals>();
  for (const l of lines) {
    if (l.kind === "markup" || l.kind === "adjustment") continue;
    const t = byPid.get(l.property_id) ?? { property_id: l.property_id, name: propName(l.property_id), room: 0, safari: 0, transfer: 0, addon: 0, discount: 0, total: 0 };
    t[l.kind as "room" | "safari" | "transfer" | "addon" | "discount"] += l.amount;
    t.total += l.amount;
    byPid.set(l.property_id, t);
  }
  const order = (pid: string | null) => {
    const i = trip.stays.findIndex((s) => s.property_id === pid);
    return i < 0 ? 999 : i;
  };
  const byProperty = [...byPid.values()].sort((a, b) => order(a.property_id) - order(b.property_id));

  // ---------------- dates, currency, payments ----------------
  const arrival = trip.stays.length ? trip.stays.map((s) => s.check_in).sort()[0] : null;
  const departure = trip.stays.length ? trip.stays.map((s) => addDays(s.check_in, s.nights)).sort().slice(-1)[0] : null;
  const currency = trip.currency ?? "INR";
  const fx = data.settings.fx?.USD ?? null;
  if (currency === "USD" && !fx) errors.push("Set the USD exchange rate in Sales settings to quote in USD.");
  const grandInCurrency = currency === "USD" && fx ? Math.round((grand / fx) * 100) / 100 : grand;

  const payments = paymentSchedule(grand, arrival, trip.booking_date, data.settings.payment_slabs?.length ? data.settings.payment_slabs : DEFAULT_PAYMENT_SLABS);

  return {
    lines,
    totals: { room, safari, transfer, addon, discount, markup, adjustment, grand },
    byProperty,
    guests,
    perPerson: guests ? round(grand / guests) : grand,
    arrival,
    departure,
    currency,
    fx,
    grandInCurrency,
    payments,
    appliedOffers,
    errors,
    warnings,
  };
}

// Instalments due on or before the booking date are merged into the deposit.
export function paymentSchedule(grand: number, arrival: ISODate | null, bookingDate: ISODate, slabs: PaymentSlab[]): Instalment[] {
  const withDue = slabs.map((s) => ({
    ...s,
    due: s.days_before_arrival == null || !arrival ? null : addDays(arrival, -s.days_before_arrival),
  }));
  const now = withDue.filter((s) => s.due === null || s.due <= bookingDate);
  const later = withDue.filter((s) => s.due !== null && s.due > bookingDate).sort((a, b) => (a.due! < b.due! ? -1 : 1));

  const out: Instalment[] = [];
  if (now.length) {
    const pct = now.reduce((t, s) => t + s.pct, 0);
    const merged = now.length > 1;
    out.push({
      label: merged ? `${pct}% deposit` : `${pct}% ${now[0].label.toLowerCase()}`,
      pct,
      due: null,
      amount: 0,
      note: merged ? `Includes ${now.filter((s) => s.due !== null).map((s) => `${s.label.toLowerCase()} (due ${s.due})`).join(", ")}, already past.` : undefined,
    });
  }
  for (const s of later) out.push({ label: `${s.pct}% ${s.label.toLowerCase()}`, pct: s.pct, due: s.due, amount: 0 });

  let allocated = 0;
  out.forEach((p, i) => {
    p.amount = i === out.length - 1 ? grand - allocated : round((grand * p.pct) / 100);
    allocated += p.amount;
  });
  return out;
}
