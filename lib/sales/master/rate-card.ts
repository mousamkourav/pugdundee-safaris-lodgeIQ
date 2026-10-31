// =====================================================================
// The owner's rate documents (2026-27), written down so Master data can be checked
// against them (lib/sales/master/rate-audit.ts, Master data > Rate audit) and corrected
// (supabase/sales_rate_card_2026.sql):
//   - Selling-rate card 2025-26 (photo): 33 road transfers, Innova / Crysta and
//     Dzire / Etios, + 5% GST, one rate both ways; the roads "via" a place are add-ons
//   - Tariff 26-27 foreign nationals (xlsx): Cottage / Tree House / Forest Suite / Deluxe
//     Room by Shoulder / High / Peak, AP + 18% GST; Indian guests pay the published tariff
//   - Safari and activity rates for lodges - foreigners (docx): MP parks and Tadoba
//   - KRL B2B Inbound 2026-2027 (pdf): Ken River Lodge rooms and experiences, taxes included
//   - Partner hotels (the owner's list): Roseate House, Agra, Jaipur, Iora, Mayfair, Radisson
// Only what the documents (and the owner's answers of 31 Oct 2026) say clearly is
// checked; the rest is in RATE_CARD_QUESTIONS, never guessed.
// =====================================================================

// The lodge (or lodges) a park name on the rate card stands for.
export const CARD_LODGES: Record<string, string[]> = {
  Satpura: ["Denwa Backwater Escape"],
  Kanha: ["Kanha Earth Lodge"],
  Bandhavgarh: ["Kings Lodge", "Tree House Hideaway"],
  Pench: ["Pench Tree Lodge"],
  Tadoba: ["Waghoba Eco Lodge"],
  Panna: ["Ken River Lodge"],
  Iora: ["Iora Retreat"],
};

// The places a town on the card stands for (owner, 31 Oct 2026): the airport, and the
// railway station of the same city too for Bhopal, Jabalpur and Nagpur; the stations
// for Itarsi, Hoshangabad (Narmadapuram) and Pipariya; otherwise the place by its name
// (an airport first, then a station, then any place).
export const CARD_PLACES: Record<string, { names: string[]; types: ("airport" | "railway" | "any")[] }> = {
  Bhopal: { names: ["Bhopal"], types: ["airport", "railway"] },
  Jabalpur: { names: ["Jabalpur"], types: ["airport", "railway"] },
  Nagpur: { names: ["Nagpur"], types: ["airport", "railway"] },
  Itarsi: { names: ["Itarsi"], types: ["railway"] },
  Hoshangabad: { names: ["Hoshangabad", "Narmadapuram"], types: ["railway"] },
  Pipariya: { names: ["Pipariya"], types: ["railway"] },
  "Raipur Airport": { names: ["Raipur"], types: ["airport"] },
  "Guwahati Airport": { names: ["Guwahati"], types: ["airport"] },
  "Jorhat Airport": { names: ["Jorhat"], types: ["airport"] },
  "Chandrapur station": { names: ["Chandrapur"], types: ["railway"] },
};

export interface CardTransfer {
  from: string; // a park on the card (CARD_LODGES) or a place (CARD_PLACES, else by name)
  to: string;
  innova: number;
  dzire?: number; // no Dzire / Etios rate on the document
  via?: string; // a road "via" a place: an add-on on top of the main road (CARD_VIA)
  source?: string;
}

// The selling-rate card, as printed (rupees, before 5% GST), and Iora Retreat's transfers.
export const CARD_TRANSFERS: CardTransfer[] = [
  { from: "Satpura", to: "Bhopal", innova: 9000, dzire: 7000 },
  { from: "Satpura", to: "Bhopal", innova: 9500, dzire: 6500, via: "Bhimbetka" },
  { from: "Satpura", to: "Bhopal", innova: 10500, dzire: 8500, via: "Tawa Dam" },
  { from: "Satpura", to: "Pachmarhi", innova: 10500, dzire: 9000 },
  { from: "Satpura", to: "Nagpur", innova: 12500, dzire: 10000 },
  { from: "Satpura", to: "Itarsi", innova: 7000, dzire: 5500 },
  { from: "Satpura", to: "Hoshangabad", innova: 7000, dzire: 5500 },
  { from: "Satpura", to: "Pipariya", innova: 7000, dzire: 5500 },
  { from: "Satpura", to: "Sohagpur", innova: 6000, dzire: 5000 },
  { from: "Kanha", to: "Nagpur", innova: 11000, dzire: 9000 },
  { from: "Kanha", to: "Jabalpur", innova: 9000, dzire: 7500 },
  { from: "Kanha", to: "Jabalpur", innova: 10500, dzire: 9000, via: "Bedaghat" },
  { from: "Kanha", to: "Raipur Airport", innova: 10000, dzire: 8000 },
  { from: "Kanha", to: "Pench", innova: 9000, dzire: 8000 },
  { from: "Kanha", to: "Bandhavgarh", innova: 11000, dzire: 9500 },
  { from: "Kanha", to: "Satpura", innova: 15500, dzire: 11500 },
  { from: "Bandhavgarh", to: "Jabalpur", innova: 9000, dzire: 7000 },
  { from: "Bandhavgarh", to: "Jabalpur", innova: 10500, dzire: 8500, via: "Bedaghat" },
  { from: "Bandhavgarh", to: "Katni", innova: 5000, dzire: 4000 },
  { from: "Bandhavgarh", to: "Umaria", innova: 4000, dzire: 3500 },
  { from: "Bandhavgarh", to: "Panna", innova: 9500, dzire: 7500 },
  { from: "Bandhavgarh", to: "Pench", innova: 15000, dzire: 11500 },
  { from: "Bandhavgarh", to: "Khajuraho", innova: 11000, dzire: 9000 },
  { from: "Pench", to: "Nagpur", innova: 9000, dzire: 7000 },
  { from: "Pench", to: "Satpura", innova: 11500, dzire: 9000 },
  { from: "Pench", to: "Jabalpur", innova: 9500, dzire: 7500 },
  { from: "Pench", to: "Kanha", innova: 9000, dzire: 8000 },
  { from: "Pench", to: "Bandhavgarh", innova: 15500, dzire: 11500 },
  { from: "Pench", to: "Tadoba", innova: 11000, dzire: 9000 },
  { from: "Tadoba", to: "Nagpur", innova: 7500, dzire: 6500 },
  { from: "Tadoba", to: "Satpura", innova: 16500, dzire: 13000 },
  { from: "Tadoba", to: "Pench", innova: 11000, dzire: 9000 },
  { from: "Tadoba", to: "Chandrapur station", innova: 5000, dzire: 4000 },
  // Iora Retreat (Kaziranga): + 5% GST for now (owner, 31 Oct 2026; to be confirmed)
  { from: "Iora", to: "Guwahati Airport", innova: 13000, source: "Partner hotels" },
  { from: "Iora", to: "Jorhat Airport", innova: 10000, source: "Partner hotels" },
];
export const CARD_TRANSFER_GST = 5;
export const VEHICLES = { innova: "Innova / Crysta", dzire: "Dzire / Etios" } as const;
// Guests per vehicle for new rates (owner: as in Master data now).
export const VEHICLE_CAPACITY = { innova: 6, dzire: 3 } as const;

// A road "via" a place: an add-on at the lodge, the extra per vehicle on top of the main road
// (owner, 31 Oct 2026). Dzire / Etios via Bhimbetka is + 0 for now (the card's 6,500 is below
// the direct 7,000; management to confirm), so it has no add-on.
export interface CardVia {
  via: string;
  name: string; // the add-on's name in Master data
  lodges: string[];
  innova: number;
  dzire: number;
}
export const CARD_VIA: CardVia[] = [
  { via: "Tawa Dam", name: "Transfer via Tawa Dam (extra per vehicle)", lodges: ["Denwa Backwater Escape"], innova: 1500, dzire: 1500 },
  { via: "Bedaghat", name: "Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)", lodges: ["Kanha Earth Lodge", "Kings Lodge", "Tree House Hideaway"], innova: 1500, dzire: 1500 },
  { via: "Bhimbetka", name: "Transfer via Bhimbetka, Innova / Crysta (extra per vehicle)", lodges: ["Denwa Backwater Escape"], innova: 500, dzire: 0 },
];

// ---------------- rooms ----------------

// A room rate from a document. A date is checked on "on" (a night inside the period);
// "to" is the last night the document gives, checked against the rate's end date.
export interface CardRoom {
  source: string;
  hotel: string; // as in Master data (matched by its start)
  room?: string; // matched by its start; empty = any room of the hotel
  meal: "CP" | "MAP" | "AP" | "EP";
  on: string;
  from?: string; // the first night, for a new rate (SQL)
  to?: string;
  double: number;
  single?: number;
  tax_pct?: number; // GST added on top (18% above Rs 7,500 a night)
  tax_included?: boolean;
}

// to 31 Mar 2027, then 1 Apr - 30 Sep 2027 (owner, 31 Oct 2026: also for Agra and Jaipur, B&B)
const twoPeriods = (source: string, hotel: string, winter: number, summer: number, meal: CardRoom["meal"] = "CP"): CardRoom[] => [
  { source, hotel, meal, on: "2027-03-15", from: "2026-10-01", to: "2027-03-31", double: winter, tax_pct: 18 },
  { source, hotel, meal, on: "2027-05-15", from: "2027-04-01", to: "2027-09-30", double: summer, tax_pct: 18 },
];

export const CARD_ROOMS: CardRoom[] = [
  ...twoPeriods("Partner hotels", "Roseate House", 23000, 17000),
  ...twoPeriods("Partner hotels", "DoubleTree", 20000, 15000),
  ...twoPeriods("Partner hotels", "Courtyard", 20000, 15000),
  ...twoPeriods("Partner hotels", "ITC Mughal", 25000, 15000),
  ...twoPeriods("Partner hotels", "ITC Rajputana", 25000, 15000),
  { source: "Partner hotels", hotel: "Iora", meal: "AP", on: "2027-03-15", to: "2027-05-31", double: 15000, single: 12000 },
  { source: "Partner hotels", hotel: "Mayfair", room: "Jungle View", meal: "AP", on: "2027-03-15", to: "2027-05-31", double: 17000, single: 15500 },
  { source: "Partner hotels", hotel: "Mayfair", room: "Mountain View", meal: "AP", on: "2027-03-15", to: "2027-05-31", double: 18000, single: 16500 },
  { source: "Partner hotels", hotel: "Radisson", meal: "CP", on: "2027-03-15", double: 15000 },
];

// The Pugdundee tariff 2026-27 (AP, + 18% GST), valid 1 Oct 2026 - 30 Sep 2027.
// Foreign guests by season; Indian guests the published tariff all year.
export const TARIFF_FROM = "2026-10-01";
export const TARIFF_TO = "2027-09-30";
export interface CardTariff {
  category: string; // sales_rate_categories.name (matched without spaces: "Treehouse" = "Tree House")
  nationality: "foreign" | "indian";
  season: "shoulder" | "high" | "peak" | "all";
  single: number;
  double: number;
}
const tariff = (category: string, rows: [number, number][], published: [number, number]): CardTariff[] => [
  ...(["shoulder", "high", "peak"] as const).map((season, i) => ({ category, nationality: "foreign" as const, season, single: rows[i][0], double: rows[i][1] })),
  { category, nationality: "indian", season: "all", single: published[0], double: published[1] },
];
export const CARD_TARIFF: CardTariff[] = [
  ...tariff("Cottage", [[15000, 18000], [18500, 22000], [20000, 23000]], [27000, 30000]),
  ...tariff("Tree House", [[17250, 21000], [21000, 25500], [22000, 26500]], [30000, 33000]),
  ...tariff("Forest Suite", [[19000, 23500], [22000, 26000], [23000, 27500]], [33000, 37000]),
  ...tariff("Deluxe Room", [[13000, 16000], [14000, 18000], [16000, 20000]], [21000, 24000]),
];

// The season calendar on the tariff, for 2026-27 (long weekends are added as Peak in Master data).
// "10 Mar" is both the last High day and the first Peak day; Peak wins over a season on the
// same date, so Master data is right with either row.
export const CARD_CALENDAR: { season: "shoulder" | "high" | "peak"; from: string; to: string }[] = [
  { season: "shoulder", from: "2026-10-01", to: "2026-10-31" },
  { season: "high", from: "2026-11-01", to: "2026-11-30" },
  { season: "shoulder", from: "2026-12-01", to: "2026-12-20" },
  { season: "peak", from: "2026-12-21", to: "2027-01-04" },
  { season: "shoulder", from: "2027-01-05", to: "2027-01-31" },
  { season: "high", from: "2027-02-01", to: "2027-03-10" },
  { season: "peak", from: "2027-03-10", to: "2027-04-30" },
  { season: "high", from: "2027-05-01", to: "2027-05-15" },
  { season: "shoulder", from: "2027-05-16", to: "2027-06-30" },
];

// Ken River Lodge, B2B 2026-27, AP, taxes included: weekdays (Mon-Fri), weekends (Sat-Sun),
// long weekends (21 Dec - 4 Jan, Holi, Diwali, Dussehra, 3-day holidays).
export interface CardKrlRoom {
  room: RegExp; // the room's name in Master data
  label: string;
  weekday: number;
  weekend: number;
  long: number;
  published: number;
}
export const CARD_KRL_ROOMS: CardKrlRoom[] = [
  { room: /stilted.*family|family.*stilted/i, label: "Stilted River Facing Family Cottage (2 + 2 children)", weekday: 24000, weekend: 25000, long: 26000, published: 35000 },
  { room: /^(?!.*family).*stilted/i, label: "Stilted River Facing Cottage (2 guests)", weekday: 16500, weekend: 17500, long: 18500, published: 25000 },
  { room: /premium hut|\bhut\b/i, label: "AC Premium Hut (2 guests)", weekday: 10500, weekend: 11500, long: 12500, published: 16000 },
  { room: /^(?!.*stilted).*family cottage/i, label: "AC Family Cottage, 2 bedrooms (4 guests)", weekday: 18000, weekend: 20000, long: 22000, published: 30000 },
  { room: /villa/i, label: "AC Villa Cottage, 3 bedrooms (6 guests)", weekday: 26000, weekend: 29000, long: 32000, published: 45000 },
  { room: /mud house/i, label: "AC Mud House, Jhinna Night Safari Camp (2 guests)", weekday: 10500, weekend: 11500, long: 12500, published: 16000 },
];

// ---------------- safaris ----------------

// A jeep safari rate (exclusive jeep, morning and evening). "on" is the date checked.
export interface CardSafari {
  source: string;
  park: string; // the park's name in Master data (matched by its start)
  zone: "core" | "buffer";
  nationality: "foreign" | "indian" | "all";
  on: string;
  weekday: number;
  weekend: number;
  naturalist?: number; // fee per safari (0 = included); not checked when the document gives none
  tax_pct: number; // 0 = taxes included
  book?: [number, number]; // booking window in days
}
const FOREIGN = "Safaris and activities - foreigners";
const INDIAN = "Safari rates - Indian guests";
// The MP rates say "from 01st Apr"; they apply to the whole 2026-27 season (owner, 31 Oct 2026).
const mp = (source: string, nationality: "foreign" | "indian", park: string, weekday: number, weekend: number, buffer: number, naturalist?: number): CardSafari[] => [
  { source, park, zone: "core", nationality, on: "2026-12-15", weekday, weekend, naturalist, tax_pct: 5 },
  { source, park, zone: "buffer", nationality, on: "2026-12-15", weekday: buffer, weekend: buffer, naturalist, tax_pct: 5 },
];
export const CARD_SAFARIS: CardSafari[] = [
  ...mp(FOREIGN, "foreign", "Satpura", 16500, 17500, 14000, 2500),
  ...mp(FOREIGN, "foreign", "Kanha", 17500, 18500, 15000, 2500),
  ...mp(FOREIGN, "foreign", "Bandhavgarh", 17500, 18500, 15000, 2500),
  ...mp(FOREIGN, "foreign", "Pench", 17500, 18500, 15000, 2500),
  { source: FOREIGN, park: "Tadoba", zone: "core", nationality: "foreign", on: "2026-12-15", weekday: 11500, weekend: 12500, naturalist: 2500, tax_pct: 5, book: [4, 59] },
  { source: FOREIGN, park: "Tadoba", zone: "core", nationality: "foreign", on: "2026-12-15", weekday: 14500, weekend: 19000, naturalist: 2500, tax_pct: 5, book: [60, 120] },
  { source: FOREIGN, park: "Tadoba", zone: "buffer", nationality: "foreign", on: "2026-12-15", weekday: 13500, weekend: 14500, naturalist: 2500, tax_pct: 5 },
  // Indian guests (per jeep, + 5% GST; the owner's earlier rate document, 31 Oct 2026)
  ...mp(INDIAN, "indian", "Pench", 14500, 15000, 13500),
  ...mp(INDIAN, "indian", "Kanha", 14500, 15000, 13500),
  ...mp(INDIAN, "indian", "Bandhavgarh", 14500, 15000, 13500),
  ...mp(INDIAN, "indian", "Satpura", 13500, 14000, 12500),
  { source: INDIAN, park: "Tadoba", zone: "core", nationality: "indian", on: "2026-12-15", weekday: 11000, weekend: 12000, tax_pct: 5, book: [4, 59] },
  { source: INDIAN, park: "Tadoba", zone: "core", nationality: "indian", on: "2026-12-15", weekday: 14000, weekend: 18500, tax_pct: 5, book: [60, 120] },
  { source: INDIAN, park: "Tadoba", zone: "buffer", nationality: "indian", on: "2026-12-15", weekday: 13000, weekend: 14000, tax_pct: 5 },
  // Ken River Lodge: entry, guide and naturalist included, taxes included, all guests
  { source: "Ken River Lodge B2B", park: "Panna", zone: "core", nationality: "all", on: "2026-12-15", weekday: 15000, weekend: 16000, naturalist: 0, tax_pct: 0 },
];

// ---------------- experiences and services ----------------

// An experience or service from a document: an add-on at that hotel (or a general one).
export interface CardAddon {
  source: string;
  hotel: string | null; // null = a general add-on (or at any of our lodges)
  name: RegExp; // the add-on's name in Master data
  label: string; // what the document calls it
  rate: number;
  foreign?: boolean; // the foreigners' rate: checked against the foreign rate when there is one
  unit?: "per_person" | "per_group" | "per_vehicle" | "per_room";
  tax_pct?: number; // 0 = taxes included
  min_guests?: number;
  tiers?: { max_guests: number; rate: number }[];
  included?: number; // per group: guests the rate covers...
  extra?: number; // ...and each further guest
}

const fx = (hotel: string | null, name: RegExp, label: string, rate: number, o: Partial<CardAddon> = {}): CardAddon => ({ source: FOREIGN, hotel, name, label, rate, foreign: true, tax_pct: 5, ...o });
const krl = (name: RegExp, label: string, rate: number, o: Partial<CardAddon> = {}): CardAddon => ({ source: "Ken River Lodge B2B", hotel: "Ken River", name, label, rate, tax_pct: 0, ...o });

export const CARD_ADDONS: CardAddon[] = [
  // Roseate House (Delhi)
  { source: "Partner hotels", hotel: "Roseate House", name: /airport/i, label: "Delhi airport transfer", rate: 3000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /innova|sight\s?seeing|vehicle|car\b/i, label: "Innova for Delhi sightseeing (per day)", rate: 8000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /entrance|entry|monument/i, label: "Delhi entrances", rate: 2500, unit: "per_person" },
  { source: "Partner hotels", hotel: "Roseate House", name: /^(?!.*accompany).*guide/i, label: "Local guide (per day)", rate: 8000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /accompanying guide/i, label: "Accompanying guide (per day)", rate: 11000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /agra.*1\s*n|1\s*n.*agra|agra.*one night/i, label: "Delhi-Agra-Delhi, 1 night", rate: 21000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /agra.*2\s*n|2\s*n.*agra|agra.*two nights/i, label: "Delhi-Agra-Delhi, 2 nights", rate: 25000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /jaipur.*3\s*n|3\s*n.*jaipur/i, label: "Delhi-Agra-Jaipur-Delhi, 3 nights", rate: 40000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /jaipur.*4\s*n|4\s*n.*jaipur/i, label: "Delhi-Agra-Jaipur-Delhi, 4 nights", rate: 50000 },
  // Iora Retreat (Kaziranga)
  { source: "Partner hotels", hotel: "Iora", name: /safari/i, label: "Kaziranga jeep safari, incl. naturalist", rate: 15000 },
  { source: "Partner hotels", hotel: "Iora", name: /camera/i, label: "Camera fee", rate: 500 },
  // Mayfair Chumta
  { source: "Partner hotels", hotel: "Mayfair", name: /airport/i, label: "Airport transfer", rate: 3000 },
  // Radisson Khajuraho
  { source: "Partner hotels", hotel: "Radisson", name: /sight\s?seeing/i, label: "Khajuraho sightseeing", rate: 6000 },
  { source: "Partner hotels", hotel: "Radisson", name: /guide/i, label: "Khajuraho guide", rate: 5000 },
  { source: "Partner hotels", hotel: "Radisson", name: /entrance|entry|ticket/i, label: "Khajuraho entrances", rate: 1500, unit: "per_person" },
  // Ken River Lodge B2B 2026-27 (taxes included)
  krl(/^(?!.*night).*boat/i, "Boat safari (1.5 hours, up to 4 guests)", 5000),
  krl(/night.*boat|boat.*night/i, "Night boat safari (2 hours, up to 4 guests)", 6000),
  krl(/fishing.*full|full.*fishing|fishing.*morning.*evening/i, "Fishing, full day (morning + evening), max 2", 7500, { unit: "per_person" }),
  krl(/fishing.*half|half.*fishing/i, "Fishing, half day, max 2", 4500, { unit: "per_person" }),
  krl(/bush dinner/i, "Bush dinner", 3000, { unit: "per_person" }),
  krl(/island dinner/i, "Island dinner (per couple)", 15000),
  krl(/nature walk/i, "Nature walk (per hour, max 2)", 1500),
  krl(/cycl/i, "Cycling (per hour)", 300),
  krl(/royal enfield|motorbike|motor cycle|bike/i, "Royal Enfield (per day)", 4000),
  krl(/dorm/i, "Driver dormitory (night, 3 meals)", 2000),
  // The foreigners' activity rates (Madhya Pradesh lodges)
  fx("Denwa Backwater Escape", /^(?!.*night).*boat/i, "Satpura boat safari (2 hours)", 14000, { unit: "per_group", tiers: [{ max_guests: 2, rate: 14000 }, { max_guests: 4, rate: 16000 }, { max_guests: 6, rate: 19000 }] }),
  fx("Denwa Backwater Escape", /canoe/i, "Canoe ride", 4000, { unit: "per_person", min_guests: 2 }),
  fx("Denwa Backwater Escape", /buffer walk|walk.*buffer/i, "Buffer walk", 3000, { unit: "per_person", min_guests: 2 }),
  fx("Kanha Earth Lodge", /buffer walk|walk.*buffer/i, "Buffer walk", 3000, { unit: "per_person", min_guests: 2 }),
  fx("Pench Tree Lodge", /buffer walk|walk.*buffer/i, "Buffer walk", 3000, { unit: "per_person", min_guests: 2 }),
  fx("Denwa Backwater Escape", /tawa cruise|cruise/i, "Tawa cruise (Tawa Dam to the lodge), up to 2 guests", 20000, { unit: "per_group", included: 2, extra: 1500 }),
  fx(null, /bush dinner|farm dinner/i, "Bush / farm dinner", 4000, { unit: "per_person", min_guests: 2, tax_pct: 18 }),
  fx(null, /picnic lunch/i, "Picnic lunch", 4000, { unit: "per_person", min_guests: 2, tax_pct: 18 }),
  fx(null, /culinary|cooking/i, "Culinary workshop", 2500, { unit: "per_person", min_guests: 2 }),
  fx(null, /escorted nature walk|^nature walk/i, "Escorted nature walk", 1500, { unit: "per_person", min_guests: 2 }),
  fx(null, /safari breakfast/i, "Safari breakfast (outside jeeps), up to 2 guests", 1000, { unit: "per_group", included: 2, extra: 500, tax_pct: 18 }),
  fx(null, /safari lunch/i, "Safari lunch (outside jeeps, full day)", 4000, { unit: "per_group", tax_pct: 18 }),
  // Tadoba (Waghoba Eco Lodge): boat safari up to 5 guests, transfer and naturalist included
  fx("Waghoba Eco Lodge", /boat.*1\s*h|1\s*-?\s*hour|one hour/i, "Tadoba boat safari, 1 hour", 11000, { unit: "per_group" }),
  fx("Waghoba Eco Lodge", /boat.*2\s*h|2\s*-?\s*hour|two hour/i, "Tadoba boat safari, 2 hours", 13000, { unit: "per_group" }),
  // Tadoba supplements per safari, all guests, + 5% (owner, 31 Oct 2026: add-ons at Waghoba)
  { source: FOREIGN, hotel: "Waghoba Eco Lodge", name: /moharli/i, label: "Core safari from Moharli gate (extra per safari)", rate: 4000, tax_pct: 5 },
  { source: FOREIGN, hotel: "Waghoba Eco Lodge", name: /^(?!.*scorpio).*(gypsy|modified)/i, label: "Modified Gypsy (extra per safari)", rate: 6000, tax_pct: 5 },
  { source: FOREIGN, hotel: "Waghoba Eco Lodge", name: /scorpio/i, label: "Modified Scorpio (extra per safari)", rate: 9000, tax_pct: 5 },
];

// Kept as the owner decided for now, to be confirmed with management (31 Oct 2026).
export const RATE_CARD_QUESTIONS: string[] = [
  "Dzire / Etios via Bhimbetka: + 0 (the card's 6,500 is below the direct 7,000).",
  "Iora Retreat transfers (Guwahati 13,000, Jorhat 10,000): + 5% GST.",
  "Foreigners' MP jeep safaris (\"from 01st Apr\" on the sheet): applied to the whole 2026-27 season.",
  "1 Jul - 30 Sep 2027 has no season in the calendar: quotes for those dates show \"price needed\" (core zones are closed then; buffer only).",
];
