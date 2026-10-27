// Master data for the reader tests: every park, lodge, room, airport and station the
// sales team writes about (names as in the live Master data). Rates are round numbers;
// the reader tests check what was understood, not the price.
import type { Addon, PricingData, RoomRate, SafariRate, TransferRate } from "@/lib/sales/pricing/types";
import type { BuilderContext } from "./types";

const PARKS = [
  { id: "BAN", name: "Bandhavgarh National Park" },
  { id: "KAN", name: "Kanha National Park" },
  { id: "PEN", name: "Pench National Park" },
  { id: "SAT", name: "Satpura Tiger Reserve" },
  { id: "TAD", name: "Tadoba-Andhari Tiger Reserve" },
  { id: "PAN", name: "Panna National Park" },
  { id: "KAZ", name: "Kaziranga National Park" },
];

const LODGES = [
  { id: "KL", name: "Kings Lodge", park_id: "BAN", kind: "own_lodge", fallback_priority: 1 },
  { id: "THH", name: "Tree House Hideaway", park_id: "BAN", kind: "own_lodge", fallback_priority: 2 },
  { id: "KEL", name: "Kanha Earth Lodge", park_id: "KAN", kind: "own_lodge", fallback_priority: 1 },
  { id: "PTL", name: "Pench Tree Lodge", park_id: "PEN", kind: "own_lodge", fallback_priority: 1 },
  { id: "DBE", name: "Denwa Backwater Escape", park_id: "SAT", kind: "own_lodge", fallback_priority: 1 },
  { id: "WEL", name: "Waghoba Eco Lodge", park_id: "TAD", kind: "own_lodge", fallback_priority: 1 },
  { id: "KRL", name: "Ken River Lodge", park_id: "PAN", kind: "own_lodge", fallback_priority: 1 },
  { id: "IORA", name: "Iora Retreat", park_id: "KAZ", kind: "partner_lodge", fallback_priority: 1 },
];

const ROOMS = [
  { id: "KL_C", property_id: "KL", name: "Cottage" },
  { id: "THH_T", property_id: "THH", name: "Tree House" },
  { id: "KEL_C", property_id: "KEL", name: "Cottage" },
  { id: "PTL_C", property_id: "PTL", name: "Cottage" },
  { id: "PTL_T", property_id: "PTL", name: "Tree House" },
  { id: "DBE_C", property_id: "DBE", name: "Cottage" },
  { id: "DBE_S", property_id: "DBE", name: "Forest Suite" },
  { id: "WEL_C", property_id: "WEL", name: "AC Cottage" },
  { id: "KRL_J", property_id: "KRL", name: "Jungle Cottage" },
  { id: "KRL_S", property_id: "KRL", name: "Stilted River Facing Cottage" },
  { id: "IORA_D", property_id: "IORA", name: "Deluxe Room" },
];

const PLACES = [
  { id: "NAG", name: "Nagpur Airport", type: "airport", code: "NAG" },
  { id: "JLR", name: "Jabalpur Airport", type: "airport", code: "JLR" },
  { id: "RPR", name: "Raipur Airport", type: "airport", code: "RPR" },
  { id: "BHO", name: "Bhopal Airport", type: "airport", code: "BHO" },
  { id: "HJR", name: "Khajuraho Airport", type: "airport", code: "HJR" },
  { id: "DEL", name: "Delhi Airport", type: "airport", code: "DEL" },
  { id: "GAU", name: "Guwahati Airport", type: "airport", code: "GAU" },
  { id: "KTE", name: "Katni Railway Station", type: "railway", code: "KTE" },
  { id: "JBP_RS", name: "Jabalpur Railway Station", type: "railway", code: "JBP" },
];

const rate = (room: string): RoomRate => ({
  id: `${room}_R`, room_category_id: room, valid_from: "2026-10-01", valid_to: "2027-09-30", meal_plan: "AP",
  rate_single: 20000, rate_double: 25000, extra_adult: 6000, child_rates: [], weekend_days: [],
  weekend_rate_single: null, weekend_rate_double: null, min_nights: 1, tax_pct: 0, rates_include_tax: true, active: true,
});

const safari = (park: string, zone: "core" | "buffer", session: "morning" | "afternoon" | "full_day"): SafariRate => ({
  id: `${park}_${zone}_${session}`, park_id: park, zone, vehicle_type: "exclusive_jeep", session, pricing_unit: "per_vehicle", nationality: "all",
  valid_from: "2026-10-01", valid_to: "2027-09-30", weekday_rate: session === "full_day" ? 90000 : 10000, weekend_rate: null, weekend_days: [],
  max_pax: 6, naturalist_fee: 0, guide_fee: 0, tax_pct: 0, active: true,
});

const road = (from: string, to: string, amount: number, hours: number): TransferRate => ({
  id: `${from}-${to}`, from_location_id: from, to_location_id: to, vehicle_type: "Innova", capacity: 4, rate: amount, drive_hours: hours,
  night_surcharge: 0, valid_from: null, valid_to: null, bidirectional: true, tax_pct: 0, active: true,
});

const addon = (id: string, name: string, property_id: string | null, amount: number, park_id: string | null = null): Addon => ({
  id, name, property_id, park_id, pricing_unit: "per_person", rate: amount, tax_pct: 0, active: true,
});

const pricing: PricingData = {
  properties: LODGES.map(({ id, name, park_id, kind }) => ({ id, name, park_id, kind })),
  rooms: ROOMS.map((r) => ({ ...r, max_adults: 2, max_children: 1, extra_bed: true })),
  roomRates: ROOMS.map((r) => rate(r.id)),
  parks: PARKS,
  closures: [
    // the monsoon: core zones shut from July to September
    ...["BAN", "KAN", "PEN", "SAT", "TAD", "PAN"].map((park) => ({
      park_id: park, zone: "core" as const, closure_type: "date_range" as const, weekday: null, session: "full_day" as const,
      date_from: "2027-07-01", date_to: "2027-09-30", label: "Monsoon",
    })),
  ],
  safariRates: [
    ...["BAN", "KAN", "PEN", "SAT", "TAD", "PAN", "KAZ"].flatMap((p) => [safari(p, "core", "morning"), safari(p, "core", "afternoon"), safari(p, "buffer", "morning"), safari(p, "buffer", "afternoon")]),
    safari("TAD", "core", "full_day"),
  ],
  locations: [...PLACES.map(({ id, name }) => ({ id, name, property_id: null })), ...LODGES.map((l) => ({ id: `L_${l.id}`, name: l.name, property_id: l.id }))],
  transferRates: [
    road("NAG", "L_WEL", 8000, 2.5),
    road("NAG", "L_PTL", 9000, 2),
    road("L_WEL", "L_PTL", 11000, 5),
    road("L_PTL", "L_KEL", 12000, 5),
    road("JLR", "L_KEL", 10000, 4),
    road("JLR", "L_KL", 9000, 4),
    road("L_KEL", "L_KL", 12000, 5),
    road("BHO", "L_DBE", 8000, 3),
    road("L_DBE", "L_PTL", 14000, 6),
    road("KTE", "L_THH", 6000, 2),
    road("L_THH", "L_KRL", 13000, 5),
    road("HJR", "L_KRL", 4000, 1),
    road("GAU", "L_IORA", 9000, 5),
    road("RPR", "L_KEL", 14000, 5),
  ],
  addons: [
    addon("BOAT_I", "Boat safari (Indian nationals)", "DBE", 2000),
    addon("BOAT_F", "Boat safari (Foreign nationals)", "DBE", 4000),
    addon("CANOE", "Canoe ride", "DBE", 3000),
    addon("NBOAT", "Night boat safari", "KRL", 5000),
    addon("FISH_H", "Fishing (half day)", "KRL", 3000),
    addon("FISH_F", "Fishing (full day)", "KRL", 5000),
    addon("WALK", "Nature walk", null, 1500),
    addon("BUSH", "Bush dinner", null, 4000),
    addon("CAM", "Camera fee", null, 500, "KAZ"),
  ],
  offers: [],
  settings: { markup_pct: 0, fx: { USD: 84 }, payment_slabs: null },
};

export const readerCtx: BuilderContext = {
  pricing,
  properties: LODGES.map((l) => ({ ...l, sort: 0 })),
  locations: [
    ...PLACES.map((p) => ({ ...p, property_id: null })),
    ...LODGES.map((l) => ({ id: `L_${l.id}`, name: l.name, type: "property", property_id: l.id })),
  ],
  rooms: ROOMS.map((r, i) => ({ ...r, sort: i })),
  templates: [],
  content: [],
  cancellation: [],
};

// The reader tests' "today".
export const READER_TODAY = "2026-10-27";
