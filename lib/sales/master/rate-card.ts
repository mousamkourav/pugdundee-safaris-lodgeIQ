// =====================================================================
// The owner's rate documents (2026-27), written down so Master data can be checked
// against them (lib/sales/master/rate-audit.ts, Master data > Rate audit).
//   - Selling-rate card 2025-26 / 2026-27: 33 road transfers, Innova / Crysta and
//     Dzire / Etios, + 5% GST, one rate both ways
//   - Partner hotels: Roseate House, Agra, Jaipur, Iora Retreat, Mayfair Chumta, Radisson Khajuraho
//   - Ken River Lodge B2B 2026-27 (taxes included): experiences
// Only what the documents say clearly is checked. What they leave open (which rows
// are single / double, the periods of the Agra and Jaipur hotels, the "via" roads)
// is listed in RATE_CARD_QUESTIONS for the owner, never guessed.
// =====================================================================

// The lodge (or lodges) a park name on the rate card stands for.
export const CARD_LODGES: Record<string, string[]> = {
  Satpura: ["Denwa Backwater Escape"],
  Kanha: ["Kanha Earth Lodge"],
  Bandhavgarh: ["Kings Lodge", "Tree House Hideaway"],
  Pench: ["Pench Tree Lodge"],
  Tadoba: ["Waghoba Eco Lodge"],
  Panna: ["Ken River Lodge"],
};

export interface CardTransfer {
  from: string; // a park on the card (CARD_LODGES) or a place
  to: string;
  innova: number;
  dzire: number;
  via?: string; // a road "via Bhimbetka": not a separate place in Master data (a question)
}

// The selling-rate card, as printed (rupees, before 5% GST).
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
];
export const CARD_TRANSFER_GST = 5;
export const VEHICLES = { innova: "Innova / Crysta", dzire: "Dzire / Etios" } as const;

// A room rate from a document. A date is checked on "on" (a night inside the period);
// "to" is the last night the document gives, checked against the rate's end date.
export interface CardRoom {
  source: string;
  hotel: string; // as in Master data (matched by its start)
  room?: string; // matched by its start; empty = the hotel's first room with rates
  meal: "CP" | "MAP" | "AP" | "EP";
  on: string;
  to?: string;
  double: number;
  single?: number;
  tax_pct?: number; // GST added on top (18% above Rs 7,500 a night)
  tax_included?: boolean;
}

export const CARD_ROOMS: CardRoom[] = [
  { source: "Partner hotels", hotel: "Roseate House", meal: "CP", on: "2027-03-15", to: "2027-03-31", double: 23000, tax_pct: 18 },
  { source: "Partner hotels", hotel: "Roseate House", meal: "CP", on: "2027-05-15", to: "2027-09-30", double: 17000, tax_pct: 18 },
  { source: "Partner hotels", hotel: "Iora", meal: "AP", on: "2027-03-15", to: "2027-05-31", double: 15000, single: 12000 },
  { source: "Partner hotels", hotel: "Mayfair", room: "Jungle View", meal: "AP", on: "2027-03-15", to: "2027-05-31", double: 17000, single: 15500 },
  { source: "Partner hotels", hotel: "Mayfair", room: "Mountain View", meal: "AP", on: "2027-03-15", to: "2027-05-31", double: 18000, single: 16500 },
  { source: "Partner hotels", hotel: "Radisson", meal: "CP", on: "2027-03-15", double: 15000 },
];

// An experience or service from a document: an add-on at that hotel (or a general one).
export interface CardAddon {
  source: string;
  hotel: string | null; // null = a general add-on
  name: RegExp; // the add-on's name in Master data
  label: string; // what the document calls it
  rate: number;
  unit?: "per_person" | "per_group" | "per_vehicle" | "per_room";
}

export const CARD_ADDONS: CardAddon[] = [
  // Roseate House (Delhi)
  { source: "Partner hotels", hotel: "Roseate House", name: /airport/i, label: "Delhi airport transfer", rate: 3000 },
  { source: "Partner hotels", hotel: "Roseate House", name: /entrance|entry|monument/i, label: "Delhi entrances", rate: 2500, unit: "per_person" },
  { source: "Partner hotels", hotel: "Roseate House", name: /local guide/i, label: "Local guide (per day)", rate: 8000 },
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
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /^(?!.*night).*boat/i, label: "Boat safari", rate: 5000 },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /night.*boat|boat.*night/i, label: "Night boat safari", rate: 6000 },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /bush dinner/i, label: "Bush dinner", rate: 3000, unit: "per_person" },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /island dinner/i, label: "Island dinner (per couple)", rate: 15000 },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /nature walk/i, label: "Nature walk (per hour)", rate: 1500 },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /cycl/i, label: "Cycling (per hour)", rate: 300 },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /royal enfield|motorbike|bike/i, label: "Royal Enfield (per day)", rate: 4000 },
  { source: "Ken River Lodge B2B", hotel: "Ken River", name: /dorm/i, label: "Driver dormitory", rate: 2000 },
];

// What the documents do not make clear: asked, never guessed or loaded.
export const RATE_CARD_QUESTIONS: string[] = [
  "Selling-rate card, roads \"via\" a place (Satpura-Bhopal via Bhimbetka 9,500 / 6,500 and via Tawa Dam 10,500 / 8,500; Kanha-Jabalpur and Bandhavgarh-Jabalpur via Bedaghat): Master data has one rate per road and vehicle. Should these be add-ons (\"via Bedaghat\"), or the main rate?",
  "Selling-rate card, Bhopal, Jabalpur and Nagpur: the airport, the railway station, or both at the same rate?",
  "Selling-rate card: how many guests per Innova / Crysta and per Dzire / Etios (capacity)? New rates use the capacity of the existing rates for that vehicle (else 4 and 3).",
  "Satpura-Itarsi, -Hoshangabad, -Pipariya and -Sohagpur: the railway stations (as places in Master data)?",
  "Agra (DoubleTree / Courtyard 20,000 / 15,000, ITC Mughal 25,000 / 15,000) and Jaipur (ITC Rajputana 25,000 / 15,000): is the first rate to 31 Mar 2027 and the second 1 Apr - 30 Sep 2027 (as at Roseate House), and B&B?",
  "Roseate House \"Innova 8,000\" and \"guide 8,000\": per day for Delhi sightseeing?",
  "Iora Retreat: transfers Guwahati 13,000 and Jorhat 10,000 - with or without GST? (Master data has Jorhat - Iora Retreat at 10,000, no GST.)",
  "Ken River Lodge B2B: the room rates (weekday / weekend / long weekend) and the jungle safari 15,000 / 16,000 (weekday / weekend, or Indian / foreign?) - please share the sheet so they can be checked.",
  "Ken River Lodge: fishing 7,500 / 4,500 per person - full day / half day?",
  "Foreign-nationals tariff 2026-27 (Cottage / Tree House / Forest Suite / Deluxe Room by Shoulder / High / Peak), the foreigners' safari and activity rates, and the Indian published flat rates: please share the sheet; Master data > Tariff can then be checked line by line.",
];
