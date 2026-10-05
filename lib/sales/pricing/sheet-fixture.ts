// The Tadoba - Pench costing sheet as master data + trip. Shared by the tests.
import type { PricingData, TripInput, SafariRate, Offer } from "./types";

const safari = (id: string, park: string, zone: "core" | "buffer", session: "morning" | "afternoon", weekend: number | null): SafariRate => ({
  id, park_id: park, zone, vehicle_type: "exclusive_jeep", session, pricing_unit: "per_vehicle", nationality: "all",
  valid_from: "2026-10-01", valid_to: "2027-06-30", weekday_rate: 21525, weekend_rate: weekend, weekend_days: weekend ? [0] : [],
  max_pax: 6, naturalist_fee: 0, guide_fee: 0, tax_pct: 0, active: true,
});

const offer = (o: Partial<Offer> & Pick<Offer, "id" | "name" | "offer_type">): Offer => ({
  value: null, stay_nights: null, pay_nights: null, applies_to: ["room"], property_ids: [], room_category_ids: [],
  book_from: null, book_to: null, travel_from: null, travel_to: null, min_nights: 1, combinable: false, active: true, ...o,
});

// Master data that reproduces the sheet. Room 43,660 a night for two AC
// cottages with one guest each = 21,830 single occupancy per room.
export const data: PricingData = {
  properties: [
    { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TADOBA" },
    { id: "PTL", name: "Pench Tree Lodge", park_id: "PENCH" },
  ],
  rooms: [
    { id: "WEL_AC", property_id: "WEL", name: "AC Cottage", max_adults: 2, max_children: 1, extra_bed: false },
    { id: "PTL_AC", property_id: "PTL", name: "AC Cottage", max_adults: 2, max_children: 1, extra_bed: false },
  ],
  roomRates: ["WEL_AC", "PTL_AC"].map((room) => ({
    id: room + "_R", room_category_id: room, valid_from: "2026-10-01", valid_to: "2027-06-30", meal_plan: "AP",
    rate_single: 21830, rate_double: 26000, extra_adult: 6000, child_rates: [], weekend_days: [],
    weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 0, rates_include_tax: true, active: true,
  })),
  parks: [
    { id: "TADOBA", name: "Tadoba" },
    { id: "PENCH", name: "Pench" },
  ],
  closures: [
    { park_id: "TADOBA", zone: "core", closure_type: "weekly", weekday: 2, session: "full_day", date_from: null, date_to: null, label: "Tuesday core closure" },
    { park_id: "PENCH", zone: "core", closure_type: "weekly", weekday: 3, session: "afternoon", date_from: null, date_to: null, label: "Wednesday afternoon" },
  ],
  safariRates: [
    safari("T_CM", "TADOBA", "core", "morning", 26250),
    safari("T_CA", "TADOBA", "core", "afternoon", 26250),
    safari("T_BM", "TADOBA", "buffer", "morning", null),
    safari("T_BA", "TADOBA", "buffer", "afternoon", null),
    safari("P_CM", "PENCH", "core", "morning", 26250),
    safari("P_CA", "PENCH", "core", "afternoon", 26250),
  ],
  locations: [
    { id: "NAG", name: "Nagpur Airport", property_id: null },
    { id: "L_WEL", name: "Waghoba Eco Lodge", property_id: "WEL" },
    { id: "L_PTL", name: "Pench Tree Lodge", property_id: "PTL" },
  ],
  transferRates: [
    { id: "TR1", from_location_id: "NAG", to_location_id: "L_WEL", vehicle_type: "Innova", capacity: 4, rate: 7875, drive_hours: 2.5, night_surcharge: 1200, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true },
    { id: "TR2", from_location_id: "L_WEL", to_location_id: "L_PTL", vehicle_type: "Innova", capacity: 4, rate: 11025, drive_hours: 5, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true },
    // stored as Nagpur -> Pench; the trip uses it in reverse (same rate for return)
    { id: "TR3", from_location_id: "NAG", to_location_id: "L_PTL", vehicle_type: "Innova", capacity: 4, rate: 9450, drive_hours: 4, night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true },
  ],
  addons: [],
  offers: [
    offer({ id: "EBO", name: "Early Bird Offer", offer_type: "fixed_rate", value: 15930 }),
    offer({ id: "P20", name: "20% off rooms", offer_type: "percent", value: 20 }),
    offer({ id: "S4P3", name: "Stay 4 pay 3", offer_type: "stay_pay", stay_nights: 4, pay_nights: 3, property_ids: ["WEL"] }),
  ],
  settings: { markup_pct: 0, fx: { USD: 84 }, payment_slabs: null },
};

export const both = (date: string, park: string, zone: "core" | "buffer") => [
  { date, park_id: park, zone, session: "morning" as const },
  { date, park_id: park, zone, session: "afternoon" as const },
];

// The trip exactly as in the sheet: 16 - 23 Jan 2027, 2 guests, 2 cottages.
export const trip: TripInput = {
  adults: 2,
  children: [],
  nationality: "foreign",
  stays: [
    { property_id: "WEL", room_category_id: "WEL_AC", meal_plan: "AP", check_in: "2027-01-16", nights: 4, rooms: 2 },
    { property_id: "PTL", room_category_id: "PTL_AC", meal_plan: "AP", check_in: "2027-01-20", nights: 3, rooms: 2 },
  ],
  safaris: [
    ...both("2027-01-17", "TADOBA", "core"), // Sunday: 52,500
    ...both("2027-01-18", "TADOBA", "core"), // 43,050
    ...both("2027-01-19", "TADOBA", "buffer"), // Tuesday, core closed
    ...both("2027-01-21", "PENCH", "core"),
    ...both("2027-01-22", "PENCH", "core"),
  ],
  transfers: [
    { date: "2027-01-16", from_location_id: "NAG", to_location_id: "L_WEL" },
    { date: "2027-01-20", from_location_id: "L_WEL", to_location_id: "L_PTL" },
    { date: "2027-01-23", from_location_id: "L_PTL", to_location_id: "NAG" },
  ],
  booking_date: "2026-10-05",
};

