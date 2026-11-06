// Red Panda Outpost: the shapes of its Master data (rp_* tables), a quote (the plan saved in a
// Sales query version, kind "red_panda") and its price. Kept apart from the Safari types: a Red
// Panda plan never goes through the Safari planner, pricing engine or reader.

export type ISODate = string;
export type Market = "b2b" | "foreign" | "indian";
export type AirportCode = "IXB" | "BDP";

export interface RpTariffRow {
  season: string;
  valid_from: ISODate;
  valid_to: ISODate;
  market: Market;
  guests: number;
  per_pax: number;
  active: boolean;
}
export interface RpSupplementRow {
  season: string;
  valid_from: ISODate;
  valid_to: ISODate;
  market: Market;
  kind: "single_room" | "tour_leader";
  amount: number;
  active: boolean;
}
export interface RpAirport {
  code: AirportCode;
  name: string;
  hours: number;
  note?: string;
}
export interface RpDayText {
  title: string;
  text: string;
}
export interface RpSettings {
  gst_pct: number;
  package_nights: number;
  min_nights: number;
  max_nights: number;
  max_guests: number;
  max_rooms: number;
  min_age: number;
  closed_months: number[];
  deposit_pct: number;
  balance_days_before: number;
  hotel_property: string; // the partner hotel near Bagdogra (name match), e.g. "Mayfair"
  airports: RpAirport[];
  title: string;
  tagline: string;
  intro: string;
  stay_text: string;
  days: RpDayText[]; // arrival, a stay day (repeated), departure
  inclusions: string[];
  exclusions: string[];
  good_to_know: string[];
  what_to_carry: string[];
  payment_terms: string;
}

// The partner hotel near Bagdogra (Mayfair): its rooms and rates from Sales Master data
// (sales_room_rates), and the Bagdogra Airport <> hotel transfer (sales_transfer_rates).
export interface RpHotelRate {
  valid_from: ISODate;
  valid_to: ISODate;
  meal_plan: string;
  rate_single: number | null;
  rate_double: number;
  tax_pct: number;
  rates_include_tax: boolean;
}
export interface RpHotelRoom {
  id: string; // sales_room_categories.id
  name: string;
  rates: RpHotelRate[];
}
export interface RpHotel {
  property_id: string;
  name: string;
  rooms: RpHotelRoom[];
  transfer: { rate: number; tax_pct: number; capacity: number; vehicle_type: string; valid_from: ISODate | null; valid_to: ISODate | null } | null;
}

export interface RpMaster {
  tariff: RpTariffRow[];
  supplements: RpSupplementRow[];
  settings: RpSettings;
  hotel: RpHotel | null;
}

export interface RpCustomItem {
  label: string;
  amount: number; // total, before GST
  gst_pct: number;
}

// The quote, as saved (sales_itinerary_versions.plan, kind "red_panda").
export interface RpPlan {
  kind: "red_panda";
  guest: {
    name: string;
    email: string;
    phone: string;
    country: string; // as typed (shown on the guest page)
    nationality: "indian" | "foreign";
    booked_by: "direct" | "agent";
    agent_name: string;
    adults: number;
    child_ages: number[]; // each 16 or more: full tariff
    rooms: number | null; // null = the standard (2 per room, 1 single when odd)
  };
  arrival: ISODate | null;
  nights: number;
  arrive_airport: AirportCode;
  depart_airport: AirportCode;
  tour_leader: boolean;
  hotel_before: { nights: number; room_id: string | null };
  hotel_after: { nights: number; room_id: string | null };
  custom_items: RpCustomItem[];
  per_pax_override: number | null; // a rate typed by hand (B2C changed for a case)
  markup_pct: number;
  discount: number;
  adjustment: { amount: number; reason: string };
  notes: string; // internal, never on the guest page
}

export interface RpLine {
  key: string;
  label: string;
  detail: string;
  amount: number; // before GST
  gst_pct: number;
  gst: number;
  group: "package" | "hotel" | "extra";
}
export interface RpPrice {
  ok: boolean;
  errors: string[];
  warnings: string[];
  season: string | null;
  market: Market;
  guests: number; // paying guests
  rooms: number;
  singles: number; // rooms with one guest
  per_pax: number; // the 5-night tariff per person used
  pro_rata: number; // nights / package nights
  lines: RpLine[];
  totals: {
    package: number; // before markup, discount and GST
    markup: number;
    discount: number;
    package_gst: number;
    hotel: number; // incl. its tax
    extras: number; // incl. GST
    adjustment: number;
    grand: number;
  };
  perPerson: number;
  arrival: ISODate | null;
  departure: ISODate | null; // the day they leave Red Panda Outpost (or the hotel after)
  outpost: { check_in: ISODate | null; check_out: ISODate | null };
  currency: "INR";
  payments: { label: string; pct: number; due: ISODate | null; amount: number; note?: string }[];
}
