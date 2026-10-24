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

import { addDays, addYears, dayName, inRange, nightsOf, weekday } from "./dates";
import type {
  Instalment,
  ISODate,
  MissingPrice,
  Offer,
  PaymentSlab,
  PriceLine,
  PriceResult,
  PricingData,
  PropertyTotals,
  RateBasis,
  RateHike,
  RoomRate,
  SafariInput,
  SafariRate,
  TransferRate,
  TripInput,
} from "./types";

const round = (n: number) => Math.round(n);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const readableDate = (d: ISODate) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export const DEFAULT_PAYMENT_SLABS: PaymentSlab[] = [
  { label: "Deposit", pct: 25, days_before_arrival: null },
  { label: "Second deposit", pct: 25, days_before_arrival: 145 },
  { label: "Final balance", pct: 50, days_before_arrival: 45 },
];

function withTax(base: number, taxPct: number, included: boolean) {
  if (!taxPct) return { amount: round(base), tax: 0 };
  // Rate already includes GST: the amount stays, but record the GST inside it
  // so the price breakup can show it separately.
  if (included) return { amount: round(base), tax: round(base - base / (1 + taxPct / 100)) };
  const tax = round((base * taxPct) / 100);
  return { amount: round(base) + tax, tax };
}

// Guests spread as evenly as possible: 5 adults in 2 rooms -> [3, 2].
export function occupancy(adults: number, rooms: number): number[] {
  const r = Math.max(1, rooms);
  return Array.from({ length: r }, (_, i) => Math.floor(adults / r) + (i < adults % r ? 1 : 0));
}

// Rates for this guest's nationality (the Pugdundee tariff has Indian and foreign rates).
const natOf = (r: RoomRate) => r.nationality ?? "all";
const forNationality = (r: RoomRate, nationality: string) => natOf(r) === "all" || natOf(r) === nationality;

function pickRoomRate(rates: RoomRate[], roomId: string, meal: string, night: ISODate, nationality: string) {
  return rates
    .filter((r) => r.active && r.room_category_id === roomId && r.meal_plan === meal && inRange(night, r.valid_from, r.valid_to) && forNationality(r, nationality))
    .sort(
      (a, b) =>
        (b.priority ?? 1) - (a.priority ?? 1) || // a lodge exception, then a long weekend, then the season
        (natOf(a) === "all" ? 1 : 0) - (natOf(b) === "all" ? 1 : 0) || // this nationality's rate before an "all guests" one
        (a.valid_from < b.valid_from ? 1 : -1) // most recent start wins
    )[0];
}

// Weekend safari rates also apply on these dates every year (e.g. 23 Dec - 2 Jan).
function inWeekendRange(date: ISODate, ranges: { from: string; to: string }[] | null | undefined) {
  const md = date.slice(5);
  return (ranges ?? []).some((r) => (r.from <= r.to ? md >= r.from && md <= r.to : md >= r.from || md <= r.to));
}

// ---------------- seasons (itineraries without fixed dates) ----------------

export type Season = RateBasis["season"];
const SEASON_WORDS: [RegExp, Season][] = [
  [/^\s*peak/i, "peak"],
  [/^\s*high/i, "high"],
  [/^\s*(shoulder|low|lean|off)/i, "shoulder"],
];

// The season of a room rate: from its note ("Shoulder.", "High.", "Peak - Diwali")
// or, without one, by price among the same room's rates (cheapest = shoulder,
// dearest = peak, in between = high).
export function seasonOfRate(r: RoomRate, siblings: RoomRate[]): Season {
  for (const [re, season] of SEASON_WORDS) if (re.test(r.notes ?? "")) return season;
  const prices = [...new Set(siblings.map((x) => x.rate_double))].sort((a, b) => a - b);
  if (prices.length <= 1) return "high";
  if (r.rate_double === prices[0]) return "shoulder";
  if (r.rate_double === prices[prices.length - 1]) return "peak";
  return "high";
}

// A room rate for a season (no date): this year's rates that have not ended,
// the season asked for, else the nearest season. "next" = next year's rates if
// master data has them, else this year's (the hike is added by the caller).
function pickRoomRateBySeason(rates: RoomRate[], roomId: string, meal: string, basis: RateBasis, today: ISODate, hike: RateHike | null | undefined, nationality: string) {
  const all = rates.filter((r) => r.active && r.room_category_id === roomId && r.meal_plan === meal && forNationality(r, nationality));
  const live = all.filter((r) => r.valid_to >= today);
  const nextYear = basis.year === "next" && hike ? live.filter((r) => r.valid_from >= hike.from) : [];
  const pool = nextYear.length ? nextYear : live.filter((r) => !hike || basis.year !== "next" || r.valid_from < hike.from);
  const source = pool.length ? pool : live.length ? live : all;
  const order: Record<Season, Season[]> = { shoulder: ["shoulder", "high", "peak"], high: ["high", "peak", "shoulder"], peak: ["peak", "high", "shoulder"] };
  for (const season of order[basis.season]) {
    const match = source.filter((r) => seasonOfRate(r, all) === season).sort((a, b) => (a.valid_from < b.valid_from ? -1 : 1))[0];
    if (match) return { rate: match, nextYearFound: nextYear.length > 0 };
  }
  return { rate: undefined, nextYearFound: false };
}

function pickSafariRateBySeason(rates: SafariRate[], s: SafariInput, nationality: string, basis: RateBasis, today: ISODate, hike: RateHike | null | undefined) {
  const vehicle = s.vehicle_type ?? "exclusive_jeep";
  const all = rates.filter(
    (r) => r.active && r.park_id === s.park_id && r.zone === s.zone && r.session === s.session && r.vehicle_type === vehicle && (r.nationality === "all" || r.nationality === nationality) && r.valid_to >= today
  );
  const nextYear = basis.year === "next" && hike ? all.filter((r) => r.valid_from >= hike.from) : [];
  const pool = nextYear.length ? nextYear : all.filter((r) => !hike || basis.year !== "next" || r.valid_from < hike.from);
  const source = pool.length ? pool : all;
  const days = (r: SafariRate) => Date.parse(r.valid_to) - Date.parse(r.valid_from);
  const rate = source.sort((a, b) => {
    const na = a.nationality === "all" ? 1 : 0;
    const nb = b.nationality === "all" ? 1 : 0;
    const wa = a.book_min_days != null || a.book_max_days != null ? 1 : 0; // an open booking window first
    const wb = b.book_min_days != null || b.book_max_days != null ? 1 : 0;
    // peak: the dearest rate (premium dates); otherwise the main rate of the season (longest period)
    const pick = basis.season === "peak" ? b.weekday_rate - a.weekday_rate : days(b) - days(a);
    return na - nb || wa - wb || pick;
  })[0];
  return { rate, nextYearFound: nextYear.length > 0 };
}

function pickSafariRate(rates: SafariRate[], s: SafariInput, nationality: string, bookingDate?: ISODate) {
  const vehicle = s.vehicle_type ?? "exclusive_jeep";
  const lead = bookingDate ? Math.round((Date.parse(s.date) - Date.parse(bookingDate)) / 86_400_000) : null;
  const inWindow = (r: SafariRate) =>
    lead === null || ((r.book_min_days == null || lead >= r.book_min_days) && (r.book_max_days == null || lead <= r.book_max_days));
  const windowed = (r: SafariRate) => (r.book_min_days != null || r.book_max_days != null ? 0 : 1);
  return rates
    .filter(
      (r) =>
        r.active &&
        r.park_id === s.park_id &&
        r.zone === s.zone &&
        r.session === s.session &&
        r.vehicle_type === vehicle &&
        (r.nationality === "all" || r.nationality === nationality) &&
        inRange(s.date, r.valid_from, r.valid_to) &&
        inWindow(r)
    )
    .sort((a, b) => {
      // a rate for this nationality beats an "all guests" rate; a rate for this
      // booking window beats an open one; then newest first
      const na = a.nationality === "all" ? 1 : 0;
      const nb = b.nationality === "all" ? 1 : 0;
      return na - nb || windowed(a) - windowed(b) || (a.valid_from < b.valid_from ? 1 : -1);
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

  // Missing rates: use the price typed by the sales person, or record what is needed.
  const manual = trip.manual_prices ?? {};
  const missing: MissingPrice[] = [];
  // Missing prices are kept apart from errors: they do not stop a draft or the
  // plan, only sending the quote to the guest. (`_why` documents the case.)
  const needPrice = (m: MissingPrice, _why: string) => {
    void _why;
    if (!missing.some((x) => x.key === m.key)) missing.push(m);
  };

  // ---------------- dates not fixed / yearly hike ----------------
  const basis = trip.rate_basis ?? null;
  const hike = data.settings.hike ?? null;
  const hikeUsed = { hotels: false, safaris: false, transfers: false };
  // dates not fixed: weekday or weekend rates as chosen, not by the calendar
  const isWeekend = (days: number[], date: ISODate) => (basis ? basis.safari_days === "weekend" && days.length > 0 : days.includes(weekday(date)));
  const withHike = (n: number, pct: number) => (pct ? n * (1 + pct / 100) : n);
  const hikeLabel = (pct: number) => (pct && hike ? ` (${hike.label} rate, +${pct}%)` : "");

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
      // The rate for this night: by date; with dates not fixed, by season. No rate
      // for the date but last year's exists and a yearly hike covers it: last year + hike.
      let rate: RoomRate | undefined;
      let hikePct = 0;
      if (basis) {
        const found = pickRoomRateBySeason(data.roomRates, stay.room_category_id, stay.meal_plan, basis, trip.booking_date, hike, trip.nationality);
        rate = found.rate;
        if (rate && basis.year === "next" && hike && !found.nextYearFound) hikePct = hike.hotels_pct;
      } else {
        rate = pickRoomRate(data.roomRates, stay.room_category_id, stay.meal_plan, night, trip.nationality);
        if (!rate && hike && inRange(night, hike.from, hike.to)) {
          rate = pickRoomRate(data.roomRates, stay.room_category_id, stay.meal_plan, addYears(night, -1), trip.nationality);
          if (rate) hikePct = hike.hotels_pct;
        }
      }
      if (hikePct) hikeUsed.hotels = true;
      if (!rate) {
        const key = `room|${stay.property_id}|${stay.room_category_id}|${stay.meal_plan}|${stay.check_in}`;
        const roomMissing: MissingPrice = { key, kind: "room", label: `${room?.name ?? "Room"} at ${propName(stay.property_id)} (${stay.meal_plan})`, unit: `per night, all ${stay.rooms} room${stay.rooms === 1 ? "" : "s"}, incl. tax`, date: basis ? null : stay.check_in };
        if (manual[key] !== undefined) {
          needPrice(roomMissing, "typed");
          const amount = round(manual[key]);
          lines.push({ kind: "room", date: night, description: label, quantity: stay.rooms, unit_price: round(amount / stay.rooms), amount, tax: 0, tax_pct: 0, property_id: stay.property_id, ref_id: stay.room_category_id, manual: true, key });
          continue;
        }
        needPrice(roomMissing, `No ${stay.meal_plan} rate for ${room?.name ?? "room"} at ${propName(stay.property_id)} from ${night}.`);
        lines.push({ kind: "room", date: night, description: label, quantity: stay.rooms, unit_price: 0, amount: 0, tax: 0, property_id: stay.property_id, ref_id: stay.room_category_id, missing: true, key });
        continue;
      }
      if (!minNightsChecked && stay.nights < rate.min_nights) {
        warnings.push(`${propName(stay.property_id)} has a minimum stay of ${rate.min_nights} nights for this rate.`);
      }
      minNightsChecked = true;

      const weekend = isWeekend(rate.weekend_days, night);
      const double = weekend && rate.weekend_rate_double != null ? rate.weekend_rate_double : rate.rate_double;
      const singleRaw = weekend && rate.weekend_rate_single != null ? rate.weekend_rate_single : rate.rate_single;
      const single = singleRaw ?? double;

      let base = 0;
      for (const n of occ) base += n <= 1 ? single : double + Math.max(0, n - 2) * (rate.extra_adult ?? 0);
      for (const age of trip.children) {
        const band = rate.child_rates.find((b) => age >= b.min_age && age <= b.max_age);
        base += band?.rate ?? 0;
      }
      base = withHike(base, hikePct);
      const { amount, tax } = withTax(base, rate.tax_pct, rate.rates_include_tax);
      lines.push({ kind: "room", date: night, description: label + hikeLabel(hikePct), quantity: stay.rooms, unit_price: round(base / stay.rooms), amount, tax, tax_pct: rate.tax_pct, property_id: stay.property_id, ref_id: stay.room_category_id, ...(hikePct ? { hike: hikePct } : {}) });
    }
  }

  // Which lodge is the guest at on a given date (check-in day to check-out day).
  const stayOn = (date: ISODate) =>
    trip.stays.find((s) => date >= s.check_in && date < addDays(s.check_in, s.nights)) ??
    trip.stays.find((s) => date === addDays(s.check_in, s.nights));

  // Accompanying naturalist, per jeep, only on safaris where it is ticked. The fee
  // comes from the safari rate, else the lodge's (or a general) "naturalist" add-on,
  // else a price the sales person types.
  const priceNaturalist = (s: TripInput["safaris"][number], rate: ReturnType<typeof pickSafariRate>, billTo: string | null, where: string) => {
    const vehicles = s.vehicles ?? Math.max(1, Math.ceil(guests / Math.max(1, rate?.max_pax ?? 6)));
    const label = `Accompanying naturalist, ${where}`;
    if (rate && rate.naturalist_fee > 0) {
      const { amount, tax } = withTax(rate.naturalist_fee * vehicles, rate.tax_pct, false);
      lines.push({ kind: "safari", group: "naturalist", date: s.date, description: label, quantity: vehicles, unit_price: rate.naturalist_fee, amount, tax, tax_pct: rate.tax_pct, property_id: billTo, ref_id: s.park_id });
      return;
    }
    const nat = (data.addons ?? []).filter((a) => a.active !== false && /naturalist/i.test(a.name));
    const addon = nat.find((a) => a.property_id === billTo) ?? nat.find((a) => !a.property_id) ?? null;
    if (addon) {
      const { amount, tax } = withTax(addon.rate * vehicles, addon.tax_pct, false);
      lines.push({ kind: "safari", group: "naturalist", date: s.date, description: label, quantity: vehicles, unit_price: addon.rate, amount, tax, tax_pct: addon.tax_pct, property_id: billTo, ref_id: addon.id });
      return;
    }
    const key = `naturalist|${s.park_id}`;
    needPrice({ key, kind: "naturalist", label: `Naturalist in ${parkName(s.park_id)}`, unit: "per safari, all jeeps, incl. tax", date: s.date }, "no naturalist rate");
    const amount = manual[key] !== undefined ? round(manual[key]) : 0;
    lines.push({ kind: "safari", group: "naturalist", date: s.date, description: label, quantity: 1, unit_price: amount, amount, tax: 0, property_id: billTo, ref_id: null, ...(manual[key] !== undefined ? { manual: true } : { missing: true }), key });
  };

  // ---------------- safaris ----------------
  for (const s of trip.safaris) {
    const sessionName = s.session === "afternoon" ? "evening" : s.session.replace("_", "-");
    const where = `${parkName(s.park_id)} ${s.zone} ${sessionName} safari`;
    const closed = basis ? null : closureFor(data, s.park_id, s.zone, s.session, s.date);
    if (closed) {
      errors.push(
        `${dayName(s.date)} ${readableDate(s.date)}: the ${s.zone} ${sessionName} safari in ${parkName(s.park_id)} is at a closed time${closed.label ? ` (${closed.label})` : ""}. Remove it or choose another zone - park closed.`
      );
    }

    let rate: SafariRate | undefined;
    let hikePct = 0;
    if (basis) {
      const found = pickSafariRateBySeason(data.safariRates, s, trip.nationality, basis, trip.booking_date, hike);
      rate = found.rate;
      if (rate && basis.year === "next" && hike && !found.nextYearFound) hikePct = hike.safaris_pct;
    } else {
      rate = pickSafariRate(data.safariRates, s, trip.nationality, trip.booking_date);
      if (!rate && hike && inRange(s.date, hike.from, hike.to)) {
        rate = pickSafariRate(data.safariRates, { ...s, date: addYears(s.date, -1) }, trip.nationality, addYears(trip.booking_date, -1));
        if (rate) hikePct = hike.safaris_pct;
      }
    }
    if (hikePct) hikeUsed.safaris = true;
    const billTo = stayOn(s.date)?.property_id ?? null;
    if (s.naturalist) priceNaturalist(s, rate, billTo, where);
    if (!rate) {
      const key = `safari|${s.park_id}|${s.zone}|${s.session}|${s.vehicle_type ?? "exclusive_jeep"}`;
      const safariMissing: MissingPrice = { key, kind: "safari", label: `${where}`, unit: "per safari, all jeeps, incl. tax", date: basis ? null : s.date };
      needPrice(safariMissing, `No rate for ${where} on ${s.date}.`);
      if (manual[key] !== undefined) {
        const amount = round(manual[key]);
        lines.push({ kind: "safari", date: s.date, description: where, quantity: 1, unit_price: amount, amount, tax: 0, tax_pct: 0, property_id: billTo, ref_id: s.park_id, manual: true, key });
        continue;
      }
      lines.push({ kind: "safari", date: s.date, description: where, quantity: 0, unit_price: 0, amount: 0, tax: 0, property_id: billTo, ref_id: s.park_id, missing: true, key });
      continue;
    }
    // weekend safari rates also on the festive dates in settings (23 Dec - 2 Jan), when dates are fixed
    const festive = !basis && rate.weekend_days.length > 0 && inWeekendRange(s.date, data.settings.safari_weekend_ranges);
    const weekend = isWeekend(rate.weekend_days, s.date) || festive;
    const unit = withHike(weekend && rate.weekend_rate != null ? rate.weekend_rate : rate.weekday_rate, hikePct);
    const vehicles = s.vehicles ?? Math.max(1, Math.ceil(guests / Math.max(1, rate.max_pax)));
    if (vehicles * rate.max_pax < guests && rate.pricing_unit !== "per_seat") warnings.push(`${where}: ${guests} guests need more than ${vehicles} jeep${vehicles === 1 ? "" : "s"} (${rate.max_pax} per jeep).`);
    // The naturalist is charged only when ticked (see priceNaturalist); the guide fee always.
    const fees = rate.guide_fee * vehicles;
    const base = rate.pricing_unit === "per_seat" ? unit * guests + fees : unit * vehicles + fees;
    const { amount, tax } = withTax(base, rate.tax_pct, false);
    const qty = rate.pricing_unit === "per_seat" ? guests : vehicles;
    lines.push({ kind: "safari", date: s.date, description: where + (qty > 1 && rate.pricing_unit !== "per_seat" ? `, ${qty} jeeps` : "") + hikeLabel(hikePct), quantity: qty, unit_price: round(unit), amount, tax, tax_pct: rate.tax_pct, property_id: billTo, ref_id: s.park_id, ...(hikePct ? { hike: hikePct } : {}) });
  }

  // ---------------- transfers ----------------
  for (const t of trip.transfers) {
    const from = locOf(t.from_location_id);
    const to = locOf(t.to_location_id);
    const label = `${from?.name ?? "?"} to ${to?.name ?? "?"}`;
    const billTo = from?.property_id ?? to?.property_id ?? null;

    // Rates for this road: this direction first; a rate entered only the other way
    // round is used too (the same road). The chosen vehicle first; if it has no rate
    // here, the cheapest vehicle that fits, with a note.
    // dates not fixed: any rate that has not ended
    const onRoute = data.transferRates.filter((r) => r.active && (basis ? !r.valid_to || r.valid_to >= trip.booking_date : inRange(t.date, r.valid_from, r.valid_to)));
    const forward = onRoute.filter(
      (r) =>
        (r.from_location_id === t.from_location_id && r.to_location_id === t.to_location_id) ||
        (r.bidirectional && r.from_location_id === t.to_location_id && r.to_location_id === t.from_location_id)
    );
    const route = forward.length ? forward : onRoute.filter((r) => r.from_location_id === t.to_location_id && r.to_location_id === t.from_location_id);
    const sameVehicle = route.filter((r) => !t.vehicle_type || r.vehicle_type.toLowerCase() === t.vehicle_type.toLowerCase());
    if (t.vehicle_type && route.length && !sameVehicle.length) {
      warnings.push(`No ${t.vehicle_type} rate for ${label}; the cheapest vehicle that fits is used.`);
    }
    const candidates = sameVehicle.length ? sameVehicle : route;
    const priced = candidates
      .map((r: TransferRate) => {
        const vehicles = t.vehicles ?? Math.max(1, Math.ceil(guests / Math.max(1, r.capacity)));
        const base = vehicles * (r.rate + (t.night ? r.night_surcharge : 0));
        return { r, vehicles, base };
      })
      .sort((a, b) => a.base - b.base)[0];

    if (!priced) {
      const key = `transfer|${t.date}|${t.from_location_id}|${t.to_location_id}`;
      needPrice({ key, kind: "transfer", label: `Transfer ${label}`, unit: "one way, all vehicles, incl. tax", date: t.date }, `No transfer rate for ${label}.`);
      if (manual[key] !== undefined) {
        const amount = round(manual[key]);
        lines.push({ kind: "transfer", date: t.date, description: label, quantity: 1, unit_price: amount, amount, tax: 0, property_id: billTo, ref_id: null, manual: true, key });
        continue;
      }
      lines.push({ kind: "transfer", date: t.date, description: label, quantity: 0, unit_price: 0, amount: 0, tax: 0, property_id: billTo, ref_id: null, missing: true, key });
      continue;
    }
    // Yearly hike: a rate without an end date (or last year's) used for a date in the hike period.
    const hikePct =
      hike && (basis ? basis.year === "next" : inRange(t.date, hike.from, hike.to)) && !(priced.r.valid_from && priced.r.valid_from >= hike.from) ? hike.transfers_pct : 0;
    if (hikePct) hikeUsed.transfers = true;
    const tBase = withHike(priced.base, hikePct);
    const { amount, tax } = withTax(tBase, priced.r.tax_pct, false);
    const hours = priced.r.drive_hours ? ` (about ${priced.r.drive_hours} hrs)` : "";
    lines.push({
      kind: "transfer",
      date: t.date,
      description: `${label} by ${priced.r.vehicle_type}${hours}${hikeLabel(hikePct)}`,
      quantity: priced.vehicles,
      unit_price: round(withHike(priced.r.rate, hikePct)),
      amount,
      tax,
      tax_pct: priced.r.tax_pct,
      property_id: billTo,
      ref_id: priced.r.id,
      ...(hikePct ? { hike: hikePct } : {}),
    });
  }

  // ---------------- add-ons ----------------
  // Children 5 and over count as guests for "each extra guest" charges.
  const countable = trip.adults + trip.children.filter((a) => a >= 5).length;
  for (const a of trip.addons ?? []) {
    const addon = data.addons.find((x) => x.id === a.addon_id && x.active);
    if (!addon) {
      errors.push("An add-on in this trip no longer exists or is inactive.");
      continue;
    }
    const foreign = trip.nationality === "foreign";
    const unitRate = foreign && addon.rate_foreign != null ? addon.rate_foreign : addon.rate;
    const extraRate = foreign && addon.extra_guest_rate_foreign != null ? addon.extra_guest_rate_foreign : addon.extra_guest_rate;
    // per group, priced by group size (boat safari: 2 / 4 / 6 guests)
    const tiers = addon.pricing_unit === "per_group" ? (foreign ? addon.tiers_foreign ?? addon.tiers : addon.tiers) ?? null : null;
    const tier = tiers?.length ? tiers.find((t) => countable <= t.max_guests) ?? tiers[tiers.length - 1] : null;
    if (addon.max_guests && countable > addon.max_guests) warnings.push(`${addon.name} takes up to ${addon.max_guests} guests; this group has ${countable}.`);
    const minGuests = addon.min_guests ?? 0;
    const qty =
      a.qty ??
      (addon.pricing_unit === "per_person" ? Math.max(guests, minGuests) : addon.pricing_unit === "per_room" ? Math.max(1, totalRooms) : 1);
    // Per group with some guests included (boat cruise: 2 guests, then Rs 1,500 each).
    const extraGuests = !tier && addon.pricing_unit === "per_group" && addon.included_guests != null && extraRate ? Math.max(0, countable - addon.included_guests) * qty : 0;
    const base = (tier ? tier.rate : unitRate) * qty + extraGuests * (extraRate ?? 0);
    const { amount, tax } = withTax(base, addon.tax_pct, false);
    let description = addon.name;
    if (extraGuests) description += ` (+${extraGuests} extra guest${extraGuests === 1 ? "" : "s"})`;
    else if (addon.pricing_unit === "per_person" && a.qty == null && minGuests > guests) description += ` (minimum ${minGuests} guests)`;
    lines.push({ kind: "addon", date: a.date ?? null, description, quantity: qty, unit_price: tier ? tier.rate : unitRate, amount, tax, tax_pct: addon.tax_pct, property_id: addon.property_id ?? (a.date ? stayOn(a.date)?.property_id ?? null : null), ref_id: addon.id });
    if (a.date && !basis && (addon.unavailable_weekdays ?? []).includes(weekday(a.date))) {
      warnings.push(`${addon.name} on ${dayName(a.date)} ${readableDate(a.date)}: ${addon.availability_note || `not available on ${dayName(a.date)}s`}.`);
    } else if (basis && addon.availability_note) {
      warnings.push(`${addon.name}: ${addon.availability_note}.`);
    }
  }

  // ---------------- items added by hand ----------------
  for (const c of trip.custom_items ?? []) {
    const amount = round(c.amount || 0);
    if (!amount) continue;
    lines.push({ kind: "addon", ...(c.group === "flight" || c.group === "hotel" ? { group: c.group } : {}), date: c.date, description: c.title, quantity: 1, unit_price: amount, amount, tax: 0, tax_pct: 0, property_id: stayOn(c.date)?.property_id ?? null, ref_id: null, manual: true });
  }

  // ---------------- prices corrected by hand (detailed price check) ----------------
  // Each line gets a stable key; a price typed for that key replaces the line's
  // amount (incl. GST, which is worked out again at the line's rate).
  const seen = new Map<string, number>();
  for (const l of lines) {
    const base = `${l.kind}|${l.date ?? ""}|${l.ref_id ?? ""}|${l.group ?? ""}|${l.description}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    l.lkey = n > 1 ? `${base}#${n}` : base;
    const typed = trip.line_prices?.[l.lkey];
    if (typed === undefined || l.missing) continue;
    const amount = round(Math.max(0, typed));
    const pct = l.tax_pct ?? 0;
    l.tax = pct ? round(amount - amount / (1 + pct / 100)) : 0;
    l.amount = amount;
    l.unit_price = l.quantity ? round((amount - l.tax) / l.quantity) : amount - l.tax;
    l.edited = true;
  }
  if (trip.line_prices && Object.keys(trip.line_prices).length) {
    const stale = Object.keys(trip.line_prices).filter((k) => !lines.some((l) => l.lkey === k));
    if (stale.length) warnings.push(`${stale.length} price${stale.length === 1 ? "" : "s"} corrected by hand no longer match a line (the plan changed) and ${stale.length === 1 ? "was" : "were"} not used.`);
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
    if (offer.offer_type === "multi_lodge") {
      const own = new Set(data.properties.filter((p) => (p.kind ?? "own_lodge") === "own_lodge").map((p) => p.id));
      const lodges = new Set(eligibleStays.filter((s) => own.has(s.property_id)).map((s) => s.property_id)).size;
      if (lodges < (offer.min_lodges ?? 2)) {
        warnings.push(`"${offer.name}" needs ${offer.min_lodges ?? 2} of our lodges in one trip; this trip has ${lodges}.`);
        continue;
      }
    }
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
    const taxBy = new Map<string | null, number>(); // GST inside the discount, so the breakup stays exact
    const add = (pid: string | null, n: number, tax = 0) => {
      discountBy.set(pid, (discountBy.get(pid) ?? 0) + n);
      taxBy.set(pid, (taxBy.get(pid) ?? 0) + tax);
    };

    if (offer.offer_type === "percent" || offer.offer_type === "multi_lodge") {
      for (const l of baseLines.filter(matches)) add(l.property_id, round((l.amount * (offer.value ?? 0)) / 100), round((l.tax * (offer.value ?? 0)) / 100));
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
      if (amt > 0) lines.push({ kind: "discount", date: null, description: offer.name, quantity: 1, unit_price: -amt, amount: -amt, tax: -(taxBy.get(pid) ?? 0), property_id: pid, ref_id: offer.id });
    }
  }

  // A multi-lodge offer the trip qualifies for but that is not ticked: say so.
  if (!toApply.length) {
    const own = new Set(data.properties.filter((p) => (p.kind ?? "own_lodge") === "own_lodge").map((p) => p.id));
    const lodges = new Set(trip.stays.filter((s) => own.has(s.property_id)).map((s) => s.property_id)).size;
    const nightsAll = trip.stays.reduce((t, s) => t + s.nights, 0);
    const best = data.offers
      .filter((o) => o.active && o.offer_type === "multi_lodge" && lodges >= (o.min_lodges ?? 2) && nightsAll >= o.min_nights && inRange(trip.booking_date, o.book_from, o.book_to))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    if (best) warnings.push(`This trip qualifies for "${best.name}" (${best.value}% off). Tick it under Offers to apply it.`);
  }

  // ---------------- % discount ----------------
  // On accommodation at our own lodges, or on the whole itinerary. GST is
  // reduced in proportion, so the breakup (net + GST) still adds up exactly.
  const disc = trip.discount;
  if (disc && disc.pct > 0) {
    if (disc.pct > 100) errors.push("The discount cannot be more than 100%.");
    if (!disc.reason?.trim()) errors.push("A discount needs a reason (for internal use).");
    const own = new Set(data.properties.filter((p) => (p.kind ?? "own_lodge") === "own_lodge").map((p) => p.id));
    const base = lines.filter((l) =>
      disc.scope === "lodges" ? l.kind === "room" && !!l.property_id && own.has(l.property_id) : ["room", "safari", "transfer", "addon", "discount"].includes(l.kind)
    );
    const pct = Math.min(100, disc.pct);
    const label = disc.scope === "lodges" ? `Discount ${pct}% on accommodation at our lodges` : `Discount ${pct}% on the itinerary`;
    const byLodge = new Map<string | null, { amount: number; tax: number }>();
    for (const l of base) {
      const key = disc.scope === "lodges" ? l.property_id : null;
      const t = byLodge.get(key) ?? { amount: 0, tax: 0 };
      t.amount += l.amount;
      t.tax += l.tax;
      byLodge.set(key, t);
    }
    for (const [pid, t] of byLodge) {
      const amt = round((t.amount * pct) / 100);
      const tax = round((t.tax * pct) / 100);
      if (amt > 0) lines.push({ kind: "discount", date: null, description: label, quantity: 1, unit_price: -amt, amount: -amt, tax: -tax, property_id: pid, ref_id: null });
    }
    if (!base.length) warnings.push(disc.scope === "lodges" ? "The discount applies to our own lodges, and this trip has none." : "There is nothing to discount yet.");
  }

  // ---------------- consolidated GST ----------------
  // One GST rate on the whole package (payment to a single account, e.g. with
  // outside hotels): every service is taken without its own GST, and the
  // package GST is added after the markup.
  const consolidated = trip.gst?.mode === "consolidated";
  const gstPct = consolidated ? Math.max(0, Math.min(28, trip.gst?.pct ?? 5)) : 0;
  if (consolidated) {
    for (const l of lines) {
      if (!["room", "safari", "transfer", "addon", "discount"].includes(l.kind)) continue;
      l.amount -= l.tax;
      l.tax = 0;
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

  const packageTax = consolidated ? round(((subtotal + markup) * gstPct) / 100) : 0;
  if (consolidated) {
    lines.push({ kind: "tax", date: null, description: `GST ${gstPct}% on the package`, quantity: 1, unit_price: packageTax, amount: packageTax, tax: packageTax, tax_pct: gstPct, property_id: null, ref_id: null });
  }

  const adjustment = round(trip.adjustment?.amount ?? 0);
  if (adjustment) {
    if (!trip.adjustment?.reason?.trim()) errors.push("A manual adjustment needs a reason.");
    lines.push({ kind: "adjustment", date: null, description: trip.adjustment?.reason?.trim() || "Manual adjustment", quantity: 1, unit_price: adjustment, amount: adjustment, tax: 0, property_id: null, ref_id: null });
  }
  const grand = subtotal + markup + packageTax + adjustment;
  if (grand < 0) errors.push("The total is below zero. Check the discount and adjustment.");

  // ---------------- per lodge ----------------
  const byPid = new Map<string | null, PropertyTotals>();
  for (const l of lines) {
    if (l.kind === "markup" || l.kind === "adjustment" || l.kind === "tax") continue;
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
  // A rate typed on the quote is used as it is; otherwise the live / settings rate,
  // less the cushion against it moving before the guest pays.
  const typedFx = currency !== "INR" && trip.fx_rate && trip.fx_rate > 0 ? trip.fx_rate : null;
  const rawFx = currency === "INR" ? null : data.settings.fx?.[currency] ?? null;
  const fx = typedFx ?? (rawFx ? Math.round(rawFx * (1 - Math.max(0, Math.min(20, data.settings.fx_margin_pct ?? 0)) / 100) * 100) / 100 : null);
  if (currency !== "INR" && !fx) errors.push(`No ${currency} exchange rate is available right now. Type the rate of exchange on Plan & price, or quote in INR.`);
  const grandInCurrency = currency !== "INR" && fx ? Math.round((grand / fx) * 100) / 100 : grand;

  // ---------------- yearly hike used ----------------
  if (hike && (hikeUsed.hotels || hikeUsed.safaris || hikeUsed.transfers)) {
    const parts = [hikeUsed.hotels && `hotels +${hike.hotels_pct}%`, hikeUsed.safaris && `safaris +${hike.safaris_pct}%`, hikeUsed.transfers && `transfers +${hike.transfers_pct}%`].filter(Boolean);
    warnings.push(`${hike.label} rates are not in master data yet, so last year's rates plus the yearly hike are used (${parts.join(", ")}).`);
  }

  const payments = paymentSchedule(grand, basis ? null : arrival, trip.booking_date, data.settings.payment_slabs?.length ? data.settings.payment_slabs : DEFAULT_PAYMENT_SLABS);

  return {
    lines,
    totals: { room, safari, transfer, addon, discount, markup, adjustment, tax: packageTax, grand },
    byProperty,
    guests,
    perPerson: perPersonOf(grand, guests, trip.adults, data.settings.per_person_basis),
    arrival,
    departure,
    currency,
    fx,
    grandInCurrency,
    payments,
    appliedOffers,
    missing,
    manualCount: lines.filter((l) => l.manual).length,
    dateless: !!basis,
    basis,
    errors,
    warnings,
  };
}

function perPersonOf(grand: number, guests: number, adults: number, basis?: string | null) {
  const n = basis === "adults" ? adults : guests;
  return n > 0 ? round(grand / n) : grand;
}

// Instalments due on or before the booking date are merged into the deposit.
export function paymentSchedule(grand: number, arrival: ISODate | null, bookingDate: ISODate, slabs: PaymentSlab[]): Instalment[] {
  // Dates not fixed: each instalment as "x days before arrival", nothing merged.
  if (!arrival) {
    const list: Instalment[] = slabs.map((s) => ({
      label: `${s.pct}% ${s.label.toLowerCase()}`,
      pct: s.pct,
      due: null,
      amount: 0,
      ...(s.days_before_arrival != null ? { note: `${s.days_before_arrival} days before arrival` } : {}),
    }));
    let given = 0;
    list.forEach((p, i) => {
      p.amount = i === list.length - 1 ? grand - given : round((grand * p.pct) / 100);
      given += p.amount;
    });
    return list;
  }
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
