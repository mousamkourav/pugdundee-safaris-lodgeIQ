// The itinerary plan as saved in sales_itinerary_versions.plan (jsonb).
// STORAGE CONTRACT: add keys freely, never rename existing ones. Bump
// schema_version if the shape changes in a way old plans cannot be read.

import type { ISODate, PricingData, Nationality } from "@/lib/sales/pricing/types";

export interface PlanGuest {
  name: string;
  email: string;
  phone: string; // international format, e.g. +919876543210
  phone_country: string; // ISO code of the phone number, e.g. IN
  country: string; // nationality as an ISO code, e.g. GB ("" = not given)
  nationality: Nationality; // derived for pricing: IN = indian, anything else = foreign
  adults: number;
  children: number[]; // ages
  rooms: number;
  source: string;
  agent_name: string;
  notes: string;
}

export interface PlanStop {
  park_id: string;
  nights: number;
  property_id: string;
  room_category_id: string;
  meal_plan: string;
  // What the guest asked for at this stop (from the chat). The day plan honours it.
  want_safaris?: number | null; // jeep safaris in total here; null = as many as fit
  want_naturalists?: number | null; // how many with a naturalist; -1 = all of them
  want_extras?: string[]; // experience keywords, e.g. "bush dinner", "boat safari"
}

// Nights in a city outside our lodges (Delhi before or after the safari).
export interface CityStay {
  when: "before" | "after";
  city: string;
  nights: number;
  hotel?: string; // name, or empty = to be confirmed
  price?: number | null; // per night, all rooms, incl. tax
}

// A flight the guest takes; placed on the right day automatically.
export interface PlanFlight {
  from: string;
  to: string;
  time?: string;
}

export type DayKind = "arrival" | "safari" | "transfer" | "leisure" | "departure" | "city";

export interface DaySafari {
  session: "morning" | "afternoon";
  zone: "core" | "buffer";
  naturalist?: boolean; // accompanying naturalist on this safari
}

// A flight leg (Delhi to Jabalpur...). Ticket details can be added once booked.
export interface FlightInfo {
  from: string;
  to: string;
  airline: string;
  number: string;
  time: string; // departure time, e.g. 08:30
  pnr: string; // empty until booked
}

// Something added to a day by hand: an add-on from master data, or anything
// typed in (an activity, a hotel not in master data, a meal, a note).
export interface PlanItem {
  id: string;
  type: "addon" | "activity" | "hotel" | "transfer" | "meal" | "note" | "flight";
  title: string;
  detail: string;
  price: number | null; // total in rupees incl. tax; null = no charge / included
  addon_id: string | null;
  qty: number | null; // add-ons only; null = automatic (guests, rooms...)
  flight?: FlightInfo; // for type "flight"
  auto?: string; // made by the planner from the guest's wishes; kept (with edits) on rebuild
}

export interface PlanDay {
  date: ISODate;
  kind: DayKind;
  property_id: string | null; // where the guest sleeps that night (null on departure day)
  park_id: string | null;
  safaris: DaySafari[];
  transfer: { from_location_id: string; to_location_id: string } | null;
  title: string;
  text: string;
  notes: string[]; // planner remarks, e.g. "core closed, buffer used"
  items: PlanItem[];
}

// Edits made on the Final draft step. Only fields the sales member changed
// are stored; everything else is generated from master data.
export interface PlanDraft {
  title?: string; // the cover headline
  subtitle?: string; // the route line under it
  about?: string;
  inclusions?: string[];
  exclusions?: string[];
  notes?: string[];
}

export interface Plan {
  schema_version: 1;
  guest: PlanGuest;
  arrival_date: ISODate;
  arrival_location_id: string | null; // null = guest reaches the first lodge on their own
  departure_location_id: string | null;
  stops: PlanStop[];
  days: PlanDay[];
  vehicle_type: string | null; // transfers; null = cheapest suitable
  offer_ids: string[];
  markup_pct: number | null;
  adjustment: { amount: number; reason: string } | null;
  currency: "INR" | "USD" | "EUR" | "GBP" | "AUD";
  draft?: PlanDraft;
  // % discount: on accommodation at our own lodges, or the whole itinerary. Reason is internal.
  discount?: { pct: number; scope: "lodges" | "all"; reason: string } | null;
  // What the guest's itinerary and PDF show.
  client?: { show_prices: boolean; show_breakup: boolean };
  manual_prices: Record<string, number>; // prices typed for rates master data does not have
  city_stays?: CityStay[];
  flights?: PlanFlight[];
}

export interface ContentBlock {
  kind: string;
  body: string;
  park_id: string | null;
  property_id: string | null;
  is_default: boolean;
}

export interface CancellationSlab {
  min_days: number;
  max_days: number | null;
  pct: number;
}

// Everything the builder needs, loaded once on the server. Plain data.
export interface BuilderContext {
  pricing: PricingData;
  properties: { id: string; name: string; park_id: string | null; kind: string; fallback_priority: number; sort: number }[];
  locations: { id: string; name: string; type: string; property_id: string | null; code?: string | null }[];
  rooms: { id: string; property_id: string; name: string; sort: number }[];
  templates: { kind: string; title: string; body: string; park_id: string | null; property_id: string | null; is_default: boolean }[];
  content: ContentBlock[]; // guest-facing text blocks (inclusions, notes, terms)
  cancellation: CancellationSlab[];
}
