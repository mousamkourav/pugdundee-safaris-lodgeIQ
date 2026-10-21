// Types for the pricing engine. Plain data only: the engine is a pure
// function (no database, no dates from the clock) so it can be tested
// against the Excel costing sheet and reused by the builder and the PDF.

export type ISODate = string; // "YYYY-MM-DD"
export type Session = "morning" | "afternoon" | "full_day";
export type Nationality = "indian" | "foreign";

// ---------- master data (shapes match the sales_* tables) ----------

export interface ChildRate {
  min_age: number;
  max_age: number;
  rate: number;
}

export interface Property {
  id: string;
  name: string;
  park_id: string | null;
  kind?: string; // own_lodge, partner_lodge, city_hotel
}

export interface RoomCategory {
  id: string;
  property_id: string;
  name: string;
  max_adults: number;
  max_children: number;
  extra_bed: boolean;
}

export interface RoomRate {
  id: string;
  room_category_id: string;
  valid_from: ISODate;
  valid_to: ISODate;
  meal_plan: string;
  rate_single: number | null;
  rate_double: number;
  extra_adult: number | null;
  child_rates: ChildRate[];
  weekend_days: number[];
  weekend_rate_single: number | null;
  weekend_rate_double: number | null;
  min_nights: number;
  tax_pct: number;
  rates_include_tax: boolean;
  active: boolean;
}

export interface Park {
  id: string;
  name: string;
}

export interface ParkClosure {
  park_id: string;
  zone: "core" | "buffer" | "all";
  closure_type: "weekly" | "date_range";
  weekday: number | null;
  session: Session;
  date_from: ISODate | null;
  date_to: ISODate | null;
  label: string | null;
}

export interface SafariRate {
  id: string;
  park_id: string;
  zone: "core" | "buffer";
  vehicle_type: string;
  session: Session;
  pricing_unit: "per_vehicle" | "per_seat";
  nationality: "indian" | "foreign" | "all";
  valid_from: ISODate;
  valid_to: ISODate;
  weekday_rate: number;
  weekend_rate: number | null;
  weekend_days: number[];
  max_pax: number;
  naturalist_fee: number;
  guide_fee: number;
  tax_pct: number;
  active: boolean;
  // Booking window (days between booking and the safari), e.g. Tadoba 60-120 vs 4-59.
  book_min_days?: number | null;
  book_max_days?: number | null;
}

export interface Location {
  id: string;
  name: string;
  property_id: string | null;
}

export interface TransferRate {
  id: string;
  from_location_id: string;
  to_location_id: string;
  vehicle_type: string;
  capacity: number;
  rate: number;
  drive_hours: number | null;
  night_surcharge: number;
  valid_from: ISODate | null;
  valid_to: ISODate | null;
  bidirectional: boolean;
  tax_pct: number;
  active: boolean;
}

export interface Addon {
  id: string;
  name: string;
  property_id: string | null;
  pricing_unit: "per_person" | "per_group" | "per_vehicle" | "per_room";
  rate: number;
  tax_pct: number;
  active: boolean;
}

export interface Offer {
  id: string;
  name: string;
  offer_type: "percent" | "fixed_rate" | "stay_pay" | "multi_lodge";
  value: number | null;
  stay_nights: number | null;
  pay_nights: number | null;
  applies_to: string[];
  property_ids: string[];
  room_category_ids: string[];
  book_from: ISODate | null;
  book_to: ISODate | null;
  travel_from: ISODate | null;
  travel_to: ISODate | null;
  min_nights: number;
  min_lodges?: number | null; // multi_lodge: this many of our own lodges in one trip
  combinable: boolean;
  active: boolean;
}

export interface PaymentSlab {
  label: string;
  pct: number;
  days_before_arrival: number | null; // null = at booking
}

export interface PricingSettings {
  markup_pct?: number | null;
  fx?: { USD?: number | null } | null;
  payment_slabs?: PaymentSlab[] | null;
  per_person_basis?: "guests" | "adults" | null; // default "guests"
}

export interface PricingData {
  properties: Property[];
  rooms: RoomCategory[];
  roomRates: RoomRate[];
  parks: Park[];
  closures: ParkClosure[];
  safariRates: SafariRate[];
  locations: Location[];
  transferRates: TransferRate[];
  addons: Addon[];
  offers: Offer[];
  settings: PricingSettings;
}

// ---------- the trip being priced ----------

export interface StayInput {
  property_id: string;
  room_category_id: string;
  meal_plan: string;
  check_in: ISODate;
  nights: number;
  rooms: number;
}

export interface SafariInput {
  date: ISODate;
  park_id: string;
  zone: "core" | "buffer";
  session: Session;
  vehicle_type?: string; // default exclusive_jeep
  vehicles?: number; // default: enough for all guests
  naturalist?: boolean; // an accompanying naturalist on this safari (per jeep)
}

export interface TransferInput {
  date: ISODate;
  from_location_id: string;
  to_location_id: string;
  vehicle_type?: string; // default: cheapest suitable
  vehicles?: number; // default: enough for all guests
  night?: boolean; // apply night surcharge
}

export interface AddonInput {
  addon_id: string;
  date?: ISODate;
  qty?: number; // default: guests / 1 group / 1 vehicle / rooms
}

export interface TripInput {
  adults: number;
  children: number[]; // ages
  nationality: Nationality;
  stays: StayInput[];
  safaris: SafariInput[];
  transfers: TransferInput[];
  addons?: AddonInput[];
  offer_ids?: string[];
  markup_pct?: number | null; // null/undefined = settings default
  adjustment?: { amount: number; reason: string } | null;
  // A % discount: on accommodation at our own lodges, or on the whole itinerary.
  discount?: { pct: number; scope: "lodges" | "all"; reason: string } | null;
  currency?: "INR" | "USD";
  booking_date: ISODate; // "today" when the quote is made
  // Prices typed by the sales person where master data has no rate, by MissingPrice.key.
  manual_prices?: Record<string, number>;
  // Items added by hand to a day (not from master data), already totalled.
  custom_items?: { date: ISODate; title: string; amount: number; group?: "flight" | "extra" }[];
}

// A rate the master data does not have. The sales person can type a price for it.
export interface MissingPrice {
  key: string;
  kind: "room" | "safari" | "transfer" | "naturalist";
  label: string;
  unit: string; // what the typed price covers
  date: ISODate | null;
}

// ---------- result ----------

export type LineKind = "room" | "safari" | "transfer" | "addon" | "discount" | "markup" | "adjustment";

export interface PriceLine {
  kind: LineKind;
  date: ISODate | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number; // rupees, tax included
  tax: number; // tax portion of amount
  group?: "naturalist" | "flight"; // shown separately in the price breakup
  property_id: string | null; // which lodge bills it
  ref_id: string | null; // room_category / park / transfer rate / addon / offer id
  missing?: boolean; // no rate found and no typed price: amount is 0 and an error is reported
  manual?: boolean; // priced with a price typed by the sales person
  key?: string; // for missing / manual lines: the MissingPrice key
}

export interface PropertyTotals {
  property_id: string | null;
  name: string;
  room: number;
  safari: number;
  transfer: number;
  addon: number;
  discount: number;
  total: number;
}

export interface Instalment {
  label: string;
  pct: number;
  due: ISODate | null; // null = at booking
  amount: number;
  note?: string;
}

export interface PriceResult {
  lines: PriceLine[];
  totals: {
    room: number;
    safari: number;
    transfer: number;
    addon: number;
    discount: number;
    markup: number;
    adjustment: number;
    grand: number;
  };
  byProperty: PropertyTotals[];
  guests: number;
  perPerson: number;
  arrival: ISODate | null;
  departure: ISODate | null;
  currency: "INR" | "USD";
  fx: number | null;
  grandInCurrency: number;
  payments: Instalment[];
  appliedOffers: string[];
  missing: MissingPrice[]; // every rate master data does not have, whether a price was typed or not
  manualCount: number; // lines priced by hand
  errors: string[]; // must be fixed before the quote is sent
  warnings: string[]; // worth checking
}
