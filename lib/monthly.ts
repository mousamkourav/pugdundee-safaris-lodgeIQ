// Field configuration for the monthly report form, derived from the Pugdundee
// Manager's Report sheet. Drives both the entry form and the dashboards.

export type FieldType = "number" | "text" | "date" | "rating" | "bool";

export interface Field {
  path: string; // dot path within `data`, e.g. "fnb.meat"
  label: string;
  type: FieldType;
  computed?: boolean; // auto-calculated; shown read-only and recomputed on save
  group?: string; // optional subsection heading within a section
}
export interface ArrayCol {
  key: string;
  label: string;
  type: FieldType;
  computed?: boolean;
}
export interface ArrayBlock {
  path: string; // e.g. "vehicles"
  label: string;
  columns: ArrayCol[];
  rows: number; // starting number of rows
  seed?: Array<Record<string, unknown>>; // prefilled label rows
  dynamic?: boolean; // if true, managers can add/remove rows with + / âˆ’
  minRows?: number; // minimum kept rows for dynamic blocks
}
export interface Section {
  key: string;
  title: string;
  fields?: Field[];
  arrays?: ArrayBlock[];
  lodges?: string[]; // if set, section only shows for these lodge names
}

const N = (path: string, label: string): Field => ({ path, label, type: "number" });
const T = (path: string, label: string): Field => ({ path, label, type: "text" });
// group tag helper: attach a subsection heading to a field
const g = (f: Field, group: string): Field => ({ ...f, group });
// computed number field (read-only in the form, recomputed on save)
const C = (path: string, label: string): Field => ({
  path,
  label,
  type: "number",
  computed: true,
});

export const SECTIONS: Section[] = [
  {
    key: "front",
    title: "Section 1 â€” Front office",
    fields: [
      // (a) Accommodation
      g(N("front.paid_rooms", "Paid rooms"), "Accommodation"),
      g(N("front.comp_rooms", "Comp rooms"), "Accommodation"),
      g(C("front.total_rooms", "Total rooms (auto)"), "Accommodation"),
      g(N("front.adults", "Adults"), "Accommodation"),
      g(N("front.child_5_12", "Children 5â€“12"), "Accommodation"),
      g(C("front.total_pax", "Total pax (auto)"), "Accommodation"),
      // (b) Extra sales
      g(N("front.extra_nature", "Nature shop sale"), "Extra sales"),
      g(N("front.extra_alcohol", "Alcohol"), "Extra sales"),
      g(N("front.extra_soft", "Soft drinks"), "Extra sales"),
      g(N("front.extra_corkage", "Corkage"), "Extra sales"),
      g(N("front.extra_laundry", "Laundry billed"), "Extra sales"),
      g(N("front.extra_food", "Extra food sale"), "Extra sales"),
      g(N("front.extra_activities", "Extra activities"), "Extra sales"),
      g(N("front.extra_transport", "Transport"), "Extra sales"),
      g(C("front.extra_total", "Total extra sales (auto)"), "Extra sales"),
      g(C("front.extra_per_room", "Per-room avg extra sale (auto)"), "Extra sales"),
      // (c) Feedback
      g({ path: "front.ta_rating", label: "TripAdvisor rating", type: "rating" }, "Feedback"),
      g(N("front.ta_pos", "TA positive (4â€“5)"), "Feedback"),
      g(N("front.ta_poor", "TA poor (1â€“3)"), "Feedback"),
      g({ path: "front.google_rating", label: "Google rating", type: "rating" }, "Feedback"),
      g(N("front.google_pos", "Google positive (4â€“5)"), "Feedback"),
      g(N("front.google_poor", "Google poor (1â€“3)"), "Feedback"),
    ],
    arrays: [
      {
        path: "travel_agents",
        label: "Travel agents visited",
        rows: 2,
        dynamic: true,
        minRows: 2,
        columns: [
          { key: "agency", label: "Agency", type: "text" },
          { key: "contact", label: "Contact", type: "text" },
          { key: "date", label: "Date", type: "date" },
        ],
      },
    ],
  },
  {
    key: "fnb",
    title: "Section 2 â€” F&B expenditure",
    fields: [
      N("fnb.meat", "Meat products"),
      N("fnb.dairy", "Dairy products"),
      N("fnb.bakery", "Bakery"),
      N("fnb.fruits", "Fruits"),
      N("fnb.vegetables", "Vegetables"),
      N("fnb.lpg", "LPG"),
      N("fnb.wood", "Wood"),
      N("fnb.grocery", "Grocery (guest & staff)"),
      N("fnb.store_issue", "F&B issued from store"),
      N("fnb.steel_bottles", "Guest steel bottles"),
      N("fnb.misc_hardware", "Misc hardware"),
      C("fnb.total", "Total F&B (auto)"),
      C("fnb.per_pax", "Avg per pax (auto)"),
      C("fnb.per_room", "Avg per room (auto)"),
    ],
  },
  {
    key: "misc",
    title: "Section 3 â€” Misc expenditure",
    fields: [
      N("misc.petrol", "Petrol"),
      N("misc.diesel", "Diesel"),
      N("misc.maint_wood", "Maintenance wood"),
      N("misc.maint_electric", "Maintenance electric"),
      N("misc.maint_plumbing", "Maintenance plumbing/painting"),
      N("misc.maint_construction", "Maintenance construction"),
      N("misc.maint_misc", "Maintenance misc"),
      N("misc.gypsy_repair", "Gypsy repairing"),
      C("misc.total", "Total misc (auto)"),
    ],
    arrays: [
      {
        path: "misc_extra",
        label: "Other misc items (added to total)",
        rows: 1,
        dynamic: true,
        minRows: 1,
        columns: [
          { key: "name", label: "Item", type: "text" },
          { key: "amount", label: "Amount", type: "number" },
        ],
      },
    ],
  },
  {
    key: "housekeeping",
    title: "Section 4 â€” Housekeeping",
    fields: [
      N("housekeeping.hk_store", "HK items from store"),
      N("housekeeping.laundry", "Laundry expense"),
      N("housekeeping.lantern_diesel", "Diesel for lantern"),
      C("housekeeping.total", "Total housekeeping (auto)"),
      C("housekeeping.per_pax", "Avg per pax (auto)"),
      C("housekeeping.per_room", "Avg per room (auto)"),
    ],
  },
  {
    key: "energy",
    title: "Section 5 â€” Maintenance / energy",
    arrays: [
      {
        path: "energy",
        label: "DG / electricity / solar",
        rows: 5,
        columns: [
          { key: "asset", label: "Asset (DG 125 / DG 30 / Electricity / Solar)", type: "text" },
          { key: "opening", label: "Opening", type: "number" },
          { key: "closing", label: "Closing", type: "number" },
          { key: "net", label: "Net usage (auto)", type: "number", computed: true },
          { key: "diesel_l", label: "Diesel (L)", type: "number" },
          { key: "cost", label: "Cost â‚¹", type: "number" },
          { key: "rate", label: "Rate/L", type: "number" },
        ],
      },
    ],
  },
  {
    key: "vehicles",
    title: "Section 6 â€” Vehicles",
    arrays: [
      {
        path: "vehicles",
        label: "Vehicles",
        rows: 6,
        dynamic: true,
        minRows: 4,
        columns: [
          { key: "vehicle_no", label: "Vehicle no.", type: "text" },
          { key: "opening_km", label: "Opening km", type: "number" },
          { key: "closing_km", label: "Closing km", type: "number" },
          { key: "total_run", label: "Total run (auto)", type: "number", computed: true },
          { key: "fuel", label: "Fuel (L)", type: "number" },
          { key: "cost", label: "Cost â‚¹", type: "number" },
          { key: "rate", label: "Rate/L", type: "number" },
        ],
      },
    ],
  },
  {
    key: "services",
    title: "Section 7 â€” Servicing",
    arrays: [
      {
        path: "services",
        label: "Asset last-service dates",
        rows: 16,
        columns: [
          { key: "asset", label: "Asset", type: "text" },
          { key: "last_service", label: "Last service", type: "text" },
        ],
      },
      {
        path: "breakdowns",
        label: "Equipment breakdowns",
        rows: 1,
        dynamic: true,
        minRows: 1,
        columns: [
          { key: "note", label: "Breakdown / issue", type: "text" },
          { key: "date", label: "Date", type: "date" },
        ],
      },
    ],
  },
  {
    key: "staff",
    title: "Section 8 â€” Staff",
    arrays: [
      {
        path: "staff_left",
        label: "Staff left",
        rows: 2,
        dynamic: true,
        minRows: 1,
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "designation", label: "Designation", type: "text" },
          { key: "date_joined", label: "Date of joining", type: "date" },
          { key: "reason", label: "Reason for leaving", type: "text" },
        ],
      },
      {
        path: "staff_joined",
        label: "New joinees",
        rows: 2,
        dynamic: true,
        minRows: 1,
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "role", label: "Designation", type: "text" },
          { key: "salary", label: "Salary", type: "number" },
        ],
      },
    ],
  },
  {
    key: "sustainability",
    title: "Section 9 â€” Sustainability (TDS)",
    fields: [
      N("sustainability.tds_station", "TDS refilling station"),
      N("sustainability.tds_kitchen", "TDS kitchen"),
      N("sustainability.tds_dining", "TDS dining"),
      T("sustainability.notes", "Notes"),
    ],
    arrays: [
      {
        path: "sustainability_items",
        label: "Other readings / initiatives",
        rows: 1,
        dynamic: true,
        minRows: 1,
        columns: [
          { key: "name", label: "Reading / item", type: "text" },
          { key: "value", label: "Value", type: "text" },
        ],
      },
    ],
  },
  {
    key: "safari",
    title: "Section 10 â€” Safari usage",
    fields: [
      N("safari.our_turn", "Our turn"),
      N("safari.against_waiting", "Against waiting / jumping"),
      N("safari.union_gypsy", "Union gypsy"),
      N("safari.outside_guest", "For outside guest"),
      N("safari.full_day", "Full day safaris"),
      N("safari.outside_pickup", "Outside pickup/drop"),
      N("safari.isuzu_pickup", "ISUZU pickup/drop"),
      N("safari.total_safaris", "Total safaris"),
    ],
  },
  {
    key: "tickets",
    title: "Section 11 â€” Ticket usage",
    fields: [
      N("tickets.delhi_used", "Delhi tickets used"),
      N("tickets.gate", "Gate taken"),
      N("tickets.agent_booked", "Booked by agent"),
      N("tickets.boat", "Boat safari"),
      N("tickets.by_guest", "By guest"),
      N("tickets.delhi_unused", "Delhi unused"),
      N("tickets.guide_regular", "Guide fees (regular)"),
      N("tickets.guide_fullday", "Guide fees (full day)"),
      T("tickets.bans", "Park bans/issues"),
      N("tickets.total_used", "Total tickets used"),
    ],
  },
  {
    key: "denwa_safari",
    title: "Section 10 — Safari & activities (Denwa)",
    lodges: ["Denwa Backwater Escape"],
    arrays: [
      {
        path: "denwa_safari",
        label: "Safari & activities",
        rows: 20,
        dynamic: true,
        minRows: 20,
        seed: [
          { category: "Core Jeep", subtype: "Madhai" },
          { category: "Core Jeep", subtype: "Churna" },
          { category: "Boat", subtype: "Hotel" },
          { category: "Boat", subtype: "Forest" },
          { category: "Tawa Cruise", subtype: "Hotel" },
          { category: "Tawa Cruise", subtype: "Jalpari" },
          { category: "Buffer Walk", subtype: "-" },
          { category: "Canoe", subtype: "-" },
          { category: "Parsapani Buffer", subtype: "Hired" },
          { category: "Parsapani Buffer", subtype: "Lodge Vehicle" },
          { category: "Jamanidev Buffer", subtype: "Hired" },
          { category: "Jamanidev Buffer", subtype: "Lodge Vehicle" },
          { category: "Activities", subtype: "Package" },
          { category: "Activities", subtype: "Extra" },
          { category: "Activities", subtype: "Complimentary" },
          { category: "Permit", subtype: "Online" },
          { category: "Permit", subtype: "Current" },
          { category: "One Day Camping", subtype: "-" },
          { category: "Two Day Camping", subtype: "-" },
          { category: "Three Day Camping", subtype: "-" },
        ],
        columns: [
          { key: "category", label: "Category", type: "text" },
          { key: "subtype", label: "Type", type: "text" },
          { key: "count", label: "No.", type: "number" },
        ],
      },
    ],
  },
  {
    key: "denwa_naturalist",
    title: "Section 10b — Naturalist assignments (Denwa)",
    lodges: ["Denwa Backwater Escape"],
    arrays: [
      {
        path: "denwa_naturalist",
        label: "Naturalist",
        rows: 4,
        dynamic: true,
        minRows: 4,
        seed: [
          { naturalist: "Kshitij" },
          { naturalist: "Neha" },
          { naturalist: "Divya" },
          { naturalist: "Mandar" },
        ],
        columns: [
          { key: "naturalist", label: "Naturalist", type: "text" },
          { key: "jeep", label: "Jeep Safari", type: "number" },
          { key: "boat", label: "Boat Safari", type: "number" },
          { key: "canoe", label: "Canoe", type: "number" },
          { key: "buffer_walk", label: "Buffer Walk", type: "number" },
        ],
      },
    ],
  },
  {
    key: "denwa_delhi",
    title: "Section 11 — For Delhi Team (Denwa)",
    lodges: ["Denwa Backwater Escape"],
    arrays: [
      {
        path: "denwa_delhi",
        label: "For Delhi Team",
        rows: 11,
        dynamic: true,
        minRows: 11,
        seed: [
          { detail: "Tickets received from Delhi used", category: "Core Safari" },
          { detail: "Tickets received from Delhi used", category: "Buffer Safari" },
          { detail: "Tickets received from Delhi unused", category: "Core Safari" },
          { detail: "Tickets received from Delhi unused", category: "Buffer Safari" },
          { detail: "Tickets taken from gate", category: "Core Safari" },
          { detail: "Tickets taken from gate", category: "Buffer Walk" },
          { detail: "Tickets taken from gate", category: "Buffer Safari" },
          { detail: "Tickets taken from gate", category: "Boat Safari" },
          { detail: "Tickets taken from gate", category: "Canoeing" },
          { detail: "Total Guide Fees Paid", category: "Regular Safari" },
          { detail: "Total Guide Fees Paid", category: "Photography Permit" },
        ],
        columns: [
          { key: "detail", label: "Detail", type: "text" },
          { key: "category", label: "Category", type: "text" },
          { key: "dec", label: "Dec 2025", type: "number" },
          { key: "total", label: "Total (auto)", type: "number", computed: true },
        ],
      },
    ],
  },
  {
    key: "accounts",
    title: "Section 12 â€” Accounts (Tally)",
    fields: [
      T("accounts.sales_date", "Sales bill entered (date)"),
      T("accounts.petty_date", "Petty cash entered (date)"),
      T("accounts.expenses_date", "Expenses entered (date)"),
    ],
  },
  {
    key: "guest",
    title: "Section 13 â€” Guest experiences & steel bottles",
    fields: [
      T("guest.experience_dinners", "Experience dinners"),
      T("guest.presentations", "Presentations"),
      T("guest.private_dinners", "Private dinners"),
      N("steel.opening", "Steel bottles â€” opening"),
      N("steel.use", "Steel bottles â€” use"),
      N("steel.closing", "Steel bottles â€” closing"),
    ],
  },
];

/* ---------- helpers shared by the form, actions and dashboards ---------- */

export function getPath(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, data);
}

export function num(data: Record<string, unknown>, path: string): number {
  const v = getPath(data, path);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- auto-calculated (derived) fields ----------
   The set of paths the dashboard treats as totals/averages. These are computed
   from their inputs both live in the form and again on save, so the two never
   drift. Anything listed here is rendered read-only in the form. */
export const COMPUTED_PATHS = new Set<string>([
  "front.total_rooms",
  "front.total_pax",
  "front.extra_total",
  "front.extra_per_room",
  "fnb.total",
  "fnb.per_pax",
  "fnb.per_room",
  "misc.total",
  "housekeeping.total",
  "housekeeping.per_pax",
  "housekeeping.per_room",
]);

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Recompute every derived field from its inputs. Pure: returns a new object,
// never mutates the argument. Used by the client form (live) and the save
// action (authoritative), so form totals always equal saved totals.
export function computeDerived(
  input: Record<string, unknown>
): Record<string, unknown> {
  const data = JSON.parse(JSON.stringify(input ?? {})) as Record<string, any>;
  data.front ??= {};
  data.fnb ??= {};
  data.misc ??= {};
  data.housekeeping ??= {};
  const f = data.front;
  const fnb = data.fnb;
  const misc = data.misc;
  const hk = data.housekeeping;

  // Front â€” rooms and pax are auto
  f.total_rooms = toNum(f.paid_rooms) + toNum(f.comp_rooms);
  const roomNights = f.total_rooms;
  f.total_pax = toNum(f.adults) + toNum(f.child_5_12);

  const extraTotal =
    toNum(f.extra_nature) +
    toNum(f.extra_alcohol) +
    toNum(f.extra_soft) +
    toNum(f.extra_corkage) +
    toNum(f.extra_laundry) +
    toNum(f.extra_food) +
    toNum(f.extra_activities) +
    toNum(f.extra_transport);
  f.extra_total = extraTotal;
  f.extra_per_room = roomNights ? round2(extraTotal / roomNights) : 0;

  // F&B â€” total and averages
  const fnbTotal =
    toNum(fnb.meat) +
    toNum(fnb.dairy) +
    toNum(fnb.bakery) +
    toNum(fnb.fruits) +
    toNum(fnb.vegetables) +
    toNum(fnb.lpg) +
    toNum(fnb.wood) +
    toNum(fnb.grocery) +
    toNum(fnb.store_issue) +
    toNum(fnb.steel_bottles) +
    toNum(fnb.misc_hardware);
  fnb.total = fnbTotal;
  fnb.per_pax = f.total_pax ? round2(fnbTotal / f.total_pax) : 0;
  fnb.per_room = roomNights ? round2(fnbTotal / roomNights) : 0;

  // Misc â€” total
  const miscExtra = Array.isArray(data.misc_extra)
    ? data.misc_extra.reduce((acc: number, r: any) => acc + toNum(r?.amount), 0)
    : 0;
  misc.total =
    toNum(misc.petrol) +
    toNum(misc.diesel) +
    toNum(misc.maint_wood) +
    toNum(misc.maint_electric) +
    toNum(misc.maint_plumbing) +
    toNum(misc.maint_construction) +
    toNum(misc.maint_misc) +
    toNum(misc.gypsy_repair) +
    miscExtra;

  // Housekeeping â€” total and averages
  const hkTotal =
    toNum(hk.hk_store) + toNum(hk.laundry) + toNum(hk.lantern_diesel);
  hk.total = hkTotal;
  hk.per_pax = f.total_pax ? round2(hkTotal / f.total_pax) : 0;
  hk.per_room = roomNights ? round2(hkTotal / roomNights) : 0;

  // Per-row array calculations (vehicles, energy)
  if (Array.isArray(data.vehicles)) {
    data.vehicles = data.vehicles.map((r: any) => {
      const row = { ...r };
      row.total_run = toNum(row.closing_km) - toNum(row.opening_km);
      row.cost = round2(toNum(row.fuel) * toNum(row.rate));
      return row;
    });
  }
  if (Array.isArray(data.denwa_delhi)) {
    const groupSums: Record<string, number> = {};
    for (const r of data.denwa_delhi as any[]) {
      const key = String(r?.detail ?? '');
      groupSums[key] = (groupSums[key] ?? 0) + toNum(r?.dec);
    }
    data.denwa_delhi = (data.denwa_delhi as any[]).map((r) => ({
      ...r,
      total: groupSums[String(r?.detail ?? '')] ?? 0,
    }));
  }
  if (Array.isArray(data.energy)) {
    data.energy = data.energy.map((r: any) => {
      const row = { ...r };
      row.net = round2(toNum(row.closing) - toNum(row.opening));
      return row;
    });
  }

  return data;
}

// Build the nested `data` object from FormData. Data inputs are named "d:<path>",
// arrays as "d:vehicles[0].fuel". Values that look numeric become numbers.
export function parseMonthlyForm(fd: FormData): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of fd.entries()) {
    if (!rawKey.startsWith("d:")) continue;
    const val = String(rawVal);
    if (val === "") continue;
    const key = rawKey.slice(2);
    const coerced: string | number | boolean =
      val === "on" ? true : /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : val;
    setDeep(data, key, coerced);
  }
  return data;
}

export function setDeep(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
) {
  // tokens: split "a.b" and "a[0].b" into ["a","b"] / ["a",0,"b"]
  const tokens: (string | number)[] = [];
  for (const part of path.split(".")) {
    const m = part.match(/^([^[]+)(\[(\d+)\])?$/);
    if (!m) {
      tokens.push(part);
      continue;
    }
    tokens.push(m[1]);
    if (m[3] !== undefined) tokens.push(Number(m[3]));
  }
  let cur: Record<string, unknown> | unknown[] = obj;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const last = i === tokens.length - 1;
    if (last) {
      (cur as Record<string | number, unknown>)[t] = value;
    } else {
      const nextIsIndex = typeof tokens[i + 1] === "number";
      const existing = (cur as Record<string | number, unknown>)[t];
      if (existing === undefined) {
        (cur as Record<string | number, unknown>)[t] = nextIsIndex ? [] : {};
      }
      cur = (cur as Record<string | number, unknown>)[t] as
        | Record<string, unknown>
        | unknown[];
    }
  }
}
