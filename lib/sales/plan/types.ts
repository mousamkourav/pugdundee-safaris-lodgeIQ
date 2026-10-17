// The itinerary plan as saved in sales_itinerary_versions.plan (jsonb).
// STORAGE CONTRACT: add keys freely, never rename existing ones. Bump
// schema_version if the shape changes in a way old plans cannot be read.

import type { ISODate, PricingData, Nationality } from "@/lib/sales/pricing/types";

export interface PlanGuest {
  name: string;
  email: string;
  phone: string;
  nationality: Nationality;
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
}

export type DayKind = "arrival" | "safari" | "transfer" | "leisure" | "departure";

export interface DaySafari {
  session: "morning" | "afternoon";
  zone: "core" | "buffer";
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
}

// Edits made on the Final draft step. Only fields the sales member changed
// are stored; everything else is generated from master data.
export interface PlanDraft {
  title?: string;
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
  currency: "INR" | "USD";
  draft?: PlanDraft;
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
