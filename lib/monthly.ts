// Field configuration for the monthly report form, derived from the Pugdundee
// Manager's Report sheet. Drives both the entry form and the dashboards.

export type FieldType = "number" | "text" | "date" | "rating" | "bool";

export interface Field {
  path: string; // dot path within `data`, e.g. "fnb.meat"
  label: string;
  type: FieldType;
}
export interface ArrayCol {
  key: string;
  label: string;
  type: FieldType;
}
export interface ArrayBlock {
  path: string; // e.g. "vehicles"
  label: string;
  columns: ArrayCol[];
  rows: number; // fixed number of editable rows
}
export interface Section {
  key: string;
  title: string;
  fields?: Field[];
  arrays?: ArrayBlock[];
}

const N = (path: string, label: string): Field => ({ path, label, type: "number" });
const T = (path: string, label: string): Field => ({ path, label, type: "text" });

export const SECTIONS: Section[] = [
  {
    key: "front",
    title: "Section 1 — Front office",
    fields: [
      N("front.paid_rooms", "Paid rooms"),
      N("front.comp_rooms", "Comp rooms"),
      N("front.total_rooms", "Total rooms"),
      N("front.adults", "Adults"),
      N("front.child_5_12", "Children 5–12"),
      N("front.child_below_5", "Children below 5"),
      N("front.total_pax", "Total pax"),
      N("front.extra_nature", "Nature shop sale"),
      N("front.extra_spa", "Spa sale"),
      N("front.extra_alcohol", "Alcohol"),
      N("front.extra_soft", "Soft drinks"),
      N("front.extra_corkage", "Corkage"),
      N("front.extra_laundry", "Laundry billed"),
      N("front.extra_food", "Extra food sale"),
      N("front.extra_activities", "Extra activities"),
      N("front.extra_transport", "Transport"),
      N("front.extra_total", "Total extra sales"),
      N("front.extra_per_room", "Per-room avg extra sale"),
      { path: "front.ta_rating", label: "TripAdvisor rating", type: "rating" },
      N("front.ta_pos", "TA positive (4–5)"),
      N("front.ta_poor", "TA poor (1–3)"),
      { path: "front.google_rating", label: "Google rating", type: "rating" },
      N("front.google_pos", "Google positive (4–5)"),
      N("front.google_poor", "Google poor (1–3)"),
    ],
    arrays: [
      {
        path: "travel_agents",
        label: "Travel agents visited",
        rows: 4,
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
    title: "Section 2 — F&B expenditure",
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
      N("fnb.total", "Total F&B"),
      N("fnb.per_pax", "Avg per pax"),
      N("fnb.per_room", "Avg per room"),
    ],
  },
  {
    key: "misc",
    title: "Section 3 — Misc expenditure",
    fields: [
      N("misc.petrol", "Petrol"),
      N("misc.diesel", "Diesel"),
      N("misc.maint_wood", "Maintenance wood"),
      N("misc.maint_electric", "Maintenance electric"),
      N("misc.maint_plumbing", "Maintenance plumbing/painting"),
      N("misc.maint_construction", "Maintenance construction"),
      N("misc.maint_misc", "Maintenance misc"),
      N("misc.gypsy_repair", "Gypsy repairing"),
      N("misc.total", "Total misc"),
    ],
  },
  {
    key: "housekeeping",
    title: "Section 4 — Housekeeping",
    fields: [
      N("housekeeping.hk_store", "HK items from store"),
      N("housekeeping.laundry", "Laundry expense"),
      N("housekeeping.lantern_diesel", "Diesel for lantern"),
      N("housekeeping.total", "Total housekeeping"),
      N("housekeeping.per_pax", "Avg per pax"),
      N("housekeeping.per_room", "Avg per room"),
    ],
  },
  {
    key: "energy",
    title: "Section 5 — Maintenance / energy",
    arrays: [
      {
        path: "energy",
        label: "DG / electricity / solar",
        rows: 5,
        columns: [
          { key: "asset", label: "Asset (DG 125 / DG 30 / Electricity / Solar)", type: "text" },
          { key: "opening", label: "Opening", type: "number" },
          { key: "closing", label: "Closing", type: "number" },
          { key: "net", label: "Net usage", type: "number" },
          { key: "diesel_l", label: "Diesel (L)", type: "number" },
          { key: "cost", label: "Cost ₹", type: "number" },
          { key: "rate", label: "Rate/L", type: "number" },
        ],
      },
    ],
  },
  {
    key: "vehicles",
    title: "Section 6 — Vehicles",
    arrays: [
      {
        path: "vehicles",
        label: "Vehicles",
        rows: 6,
        columns: [
          { key: "vehicle_no", label: "Vehicle no.", type: "text" },
          { key: "opening_km", label: "Opening km", type: "number" },
          { key: "closing_km", label: "Closing km", type: "number" },
          { key: "total_run", label: "Total run", type: "number" },
          { key: "fuel", label: "Fuel (L)", type: "number" },
          { key: "cost", label: "Cost ₹", type: "number" },
          { key: "rate", label: "Rate/L", type: "number" },
        ],
      },
    ],
  },
  {
    key: "services",
    title: "Section 7 — Servicing",
    fields: [T("breakdown_note", "Any breakdown in equipment")],
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
    ],
  },
  {
    key: "staff",
    title: "Section 8 — Staff",
    arrays: [
      {
        path: "staff_left",
        label: "Staff left",
        rows: 5,
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "reason", label: "Reason for leaving", type: "text" },
        ],
      },
      {
        path: "staff_joined",
        label: "New joinees",
        rows: 5,
        columns: [
          { key: "name", label: "Name", type: "text" },
          { key: "role", label: "Role", type: "text" },
        ],
      },
    ],
  },
  {
    key: "sustainability",
    title: "Section 9 — Sustainability (TDS)",
    fields: [
      N("sustainability.tds_station", "TDS refilling station"),
      N("sustainability.tds_kitchen", "TDS kitchen"),
      N("sustainability.tds_dining", "TDS dining"),
      T("sustainability.notes", "Notes"),
    ],
  },
  {
    key: "safari",
    title: "Section 10 — Safari usage",
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
    title: "Section 11 — Ticket usage",
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
    key: "accounts",
    title: "Section 12 — Accounts (Tally)",
    fields: [
      T("accounts.sales_date", "Sales bill entered (date)"),
      T("accounts.petty_date", "Petty cash entered (date)"),
      T("accounts.expenses_date", "Expenses entered (date)"),
    ],
  },
  {
    key: "guest",
    title: "Section 13 — Guest experiences & steel bottles",
    fields: [
      T("guest.experience_dinners", "Experience dinners"),
      T("guest.presentations", "Presentations"),
      T("guest.private_dinners", "Private dinners"),
      N("steel.opening", "Steel bottles — opening"),
      N("steel.use", "Steel bottles — use"),
      N("steel.closing", "Steel bottles — closing"),
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

function setDeep(obj: Record<string, unknown>, path: string, value: unknown) {
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
