// Group quotes (tour operators: 6 + 1 tour leader, 8 + 2...): the costing sheet and the price ladder,
// as the team does it in Excel (owner's sheet, 6 Nov 2026). Pure; tested in costing.test.ts.
//
// The sheet: one row per day with what it costs, in six kinds (each rupees, GST included):
//   single  - a room for one guest, that night        double - a room for two, that night
//   jeep    - one jeep's safaris (and naturalist) that day
//   vehicle - one vehicle's transfers that day (Innova)
//   person  - per guest: flights, fees, per-person experiences
//   group   - fixed for the whole group (an experience priced per group)
// Every cell comes from Sales Master data (buildCostSheet, through the pricing engine) and can be
// changed by hand. The ladder: for each group size (paying guests + tour leaders, jeeps, vehicles)
//   per paying guest (twin sharing) = double / 2 + person + group / paying
//                                     + jeep x jeeps / paying + vehicle x vehicles / paying
//                                     + tour leaders' cost / paying
// Tour leaders: a single room each, or two share a double; their cost is their rooms and their
// per-person items. It is divided among the paying guests, or their nights at our own lodges are
// free (the rest divided), or it is all free. Their jeep and vehicle seats are in the counts.
// Single room supplement = single - double / 2. Then rupees -> the quote's currency at the rate
// typed (US$, GBP, EUR, AUD; an Indian group in rupees needs no rate), markup %, rounded up to 50 /
// 100 (rupees: 500 / 1,000); the selling price can be typed per row. (8 Nov 2026: not only US$.)
// The saved fields keep their first names (sell_usd, usd): they hold the quote's currency.

export const GROUP_CURRENCIES = ["USD", "GBP", "EUR", "AUD", "INR"] as const;
export type GroupCurrency = (typeof GROUP_CURRENCIES)[number];
export const GROUP_CURRENCY_NAME: Record<GroupCurrency, string> = { USD: "US dollar", GBP: "British pound", EUR: "Euro", AUD: "Australian dollar", INR: "Indian rupee" };
const SIGN: Record<GroupCurrency, string> = { USD: "US$", GBP: "£", EUR: "€", AUD: "A$", INR: "₹" };
export const groupCurrency = (g: { currency?: string | null } | null | undefined): GroupCurrency =>
  (GROUP_CURRENCIES as readonly string[]).includes(String(g?.currency)) ? (g!.currency as GroupCurrency) : "USD";
// rupees per one unit of the quote's currency: 1 for rupees, else the rate typed (null = not typed)
export const groupRate = (g: { currency?: string | null; fx: number | null }): number | null =>
  groupCurrency(g) === "INR" ? 1 : g.fx && g.fx > 0 ? g.fx : null;
// "US$ 1,450", "£ 1,450", "₹ 1,23,500"
export function groupMoney(n: number | null | undefined, cur: GroupCurrency, decimals = 0): string {
  if (n == null) return "-";
  const loc = cur === "INR" ? "en-IN" : "en-US";
  return `${SIGN[cur]} ${n.toLocaleString(loc, { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}`;
}
// the rounding choices for the selling price, in the quote's currency
export const roundChoices = (cur: GroupCurrency) => (cur === "INR" ? [0, 100, 500, 1000] : [0, 10, 50, 100]);
// the default currency of a new group quote: rupees for an Indian group, else US dollars
export const defaultCurrency = (nationality: string | null | undefined): GroupCurrency => (nationality === "indian" ? "INR" : "USD");

export type GroupTlCost = "divided" | "own_lodges_free" | "free";

export interface GroupRow {
  paying: number;
  tls: number;
  jeeps: number;
  vehicles: number;
  sell_usd?: number | null; // typed selling price per person (the quote's currency); empty = cost x markup, rounded
}

export interface GroupSettings {
  paying: number; // the group size the quote is built for (also the first row)
  tls: number; // tour leaders travelling with the group
  tl_room: "single" | "share"; // a single room each, or two share a double
  tl_cost: GroupTlCost;
  per_jeep: number; // guests in one jeep on safari
  per_vehicle: number; // people (guests and tour leaders) in one vehicle on transfers
  currency?: GroupCurrency; // the quote's currency (empty = USD, quotes made before 8 Nov 2026)
  fx: number | null; // rupees per one unit of the currency, typed (not needed for INR)
  markup_pct: number;
  round_to: number; // round the selling price up to this many units of the currency (0 = no rounding)
  rows: GroupRow[];
  cells: Record<string, Partial<Record<CostKind, number>>>; // changed by hand: day key -> kind -> rupees
  booked_row?: number | null; // the row the group booked (Payments)
  singles?: number; // single rooms booked (Payments)
}

export const COST_KINDS = ["single", "double", "jeep", "vehicle", "person", "group"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_LABEL: Record<CostKind, string> = {
  single: "Single",
  double: "Double",
  jeep: "Per jeep",
  vehicle: "Per vehicle",
  person: "Per person",
  group: "Per group",
};

export interface CostDay {
  key: string; // the date (or "d3" for dates not fixed)
  n: number;
  date: string | null;
  title: string;
  stay: string; // where they sleep
  category: string;
  meal: string;
  own_lodge: boolean; // a night at one of our own lodges (tour leaders' nights can be free there)
  city_hotel: boolean; // a night at a city hotel (Delhi): the extra night before / after is priced from the first
  cost: Record<CostKind, number>; // after the changes typed by hand
  auto: Record<CostKind, number>; // from Master data
  edited: CostKind[];
  why?: Partial<Record<CostKind, string>>; // what a Master data figure is made of ("2 safaris, 2 naturalists")
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function defaultGroup(currency: GroupCurrency = "USD"): GroupSettings {
  return { paying: 6, tls: 1, tl_room: "single", tl_cost: "divided", per_jeep: 2, per_vehicle: 3, currency, fx: null, markup_pct: 0, round_to: currency === "INR" ? 500 : 50, rows: [], cells: {} };
}

// The default counts for a group size: jeeps for the paying guests, vehicles for everyone.
export const jeepsFor = (paying: number, perJeep: number) => Math.max(1, Math.ceil(paying / Math.max(1, perJeep)));
export const vehiclesFor = (people: number, perVehicle: number) => Math.max(1, Math.ceil(people / Math.max(1, perVehicle)));
export function rowFor(g: Pick<GroupSettings, "per_jeep" | "per_vehicle">, paying: number, tls: number): GroupRow {
  return { paying, tls, jeeps: jeepsFor(paying, g.per_jeep), vehicles: vehiclesFor(paying + tls, g.per_vehicle) };
}

// The typed changes applied to the sheet from Master data.
export function applyCells(days: Omit<CostDay, "cost" | "edited">[], cells: GroupSettings["cells"]): CostDay[] {
  return days.map((d) => {
    const own = cells[d.key] ?? {};
    const cost = { ...d.auto };
    const edited: CostKind[] = [];
    for (const k of COST_KINDS) {
      const v = own[k];
      if (v != null && Number.isFinite(v) && v >= 0) {
        cost[k] = r2(v);
        if (r2(v) !== d.auto[k]) edited.push(k);
      }
    }
    return { ...d, cost, edited };
  });
}

export interface SheetTotals {
  single: number;
  double: number;
  jeep: number;
  vehicle: number;
  person: number;
  group: number;
  ownDouble: number; // the double rooms at our own lodges (tour leaders' free nights)
  ownSingle: number;
  ownPerson: number; // per-person items on days at our own lodges
}

export function sheetTotals(days: CostDay[]): SheetTotals {
  const t: SheetTotals = { single: 0, double: 0, jeep: 0, vehicle: 0, person: 0, group: 0, ownDouble: 0, ownSingle: 0, ownPerson: 0 };
  for (const d of days) {
    for (const k of COST_KINDS) t[k] = r2(t[k] + num(d.cost[k]));
    if (d.own_lodge) {
      t.ownDouble = r2(t.ownDouble + num(d.cost.double));
      t.ownSingle = r2(t.ownSingle + num(d.cost.single));
      t.ownPerson = r2(t.ownPerson + num(d.cost.person));
    }
  }
  return t;
}

// The tour leaders' cost (rupees): their rooms and their per-person items.
export function tourLeaderCost(t: SheetTotals, tls: number, room: GroupSettings["tl_room"], mode: GroupTlCost): number {
  if (tls <= 0 || mode === "free") return 0;
  const free = mode === "own_lodges_free";
  const single = t.single - (free ? t.ownSingle : 0);
  const double = t.double - (free ? t.ownDouble : 0);
  const person = t.person - (free ? t.ownPerson : 0);
  const doubles = room === "share" ? Math.floor(tls / 2) : 0;
  const singles = tls - doubles * 2;
  return r2(doubles * double + singles * single + tls * person);
}

export interface LadderRow extends GroupRow {
  inr: number; // cost per paying guest, twin sharing (rupees)
  usd: number | null; // cost in dollars
  sell: number | null; // selling price per guest (dollars): typed, or cost x markup rounded up
  typed: boolean;
  margin: number | null; // sell - cost, per guest (dollars)
  tl_inr: number; // the tour leaders' cost in the group (rupees)
}

export const roundUp = (v: number, to: number) => (to > 0 ? Math.ceil(r2(v) / to - 1e-9) * to : Math.ceil(r2(v)));

export function ladderRow(t: SheetTotals, g: GroupSettings, row: GroupRow): LadderRow {
  const p = Math.max(1, Math.floor(num(row.paying)));
  const tl = tourLeaderCost(t, Math.max(0, Math.floor(num(row.tls))), g.tl_room, g.tl_cost);
  const inr = r2(t.double / 2 + t.person + t.group / p + (t.jeep * num(row.jeeps)) / p + (t.vehicle * num(row.vehicles)) / p + tl / p);
  const fx = groupRate(g);
  const usd = fx ? r2(inr / fx) : null;
  const typed = row.sell_usd != null && Number.isFinite(row.sell_usd) && row.sell_usd > 0;
  const sell = typed ? r2(row.sell_usd!) : usd != null ? roundUp(usd * (1 + num(g.markup_pct) / 100), g.round_to) : null;
  return { ...row, paying: p, inr, usd, sell, typed, margin: sell != null && usd != null ? r2(sell - usd) : null, tl_inr: tl };
}

export interface GroupPrice {
  rows: LadderRow[];
  single_supplement: { inr: number; usd: number | null; sell: number | null };
  extra_night: { name: string; inr_sharing: number; inr_single: number; usd_sharing: number | null; usd_single: number | null } | null;
  totals: SheetTotals;
  problems: string[];
}

// The whole ladder, the single room supplement and an extra night (pre / post) at the first city
// hotel of the trip (Delhi), per guest.
export function priceGroup(days: CostDay[], g: GroupSettings): GroupPrice {
  const t = sheetTotals(days);
  const problems: string[] = [];
  const cur = groupCurrency(g);
  if (!groupRate(g)) problems.push(`Type the ${GROUP_CURRENCY_NAME[cur]} rate (rupees per 1 ${cur}).`);
  const rows = (g.rows.length ? g.rows : [rowFor(g, g.paying, g.tls)]).map((r) => ladderRow(t, g, r));
  for (const r of rows) {
    if (r.paying < 1) problems.push("A group size needs at least 1 paying guest.");
    if (r.jeeps < 0 || r.vehicles < 0) problems.push("Jeeps and vehicles cannot be below 0.");
  }
  const fx = groupRate(g);
  const nightTo = cur === "INR" ? 100 : 10; // an extra night rounds up to 10 (rupees: 100)
  const srs = r2(t.single - t.double / 2);
  const firstCity = days.find((d) => d.city_hotel && d.cost.double > 0) ?? null;
  return {
    rows,
    single_supplement: { inr: srs, usd: fx ? r2(srs / fx) : null, sell: fx ? roundUp((srs / fx) * (1 + num(g.markup_pct) / 100), g.round_to) : null },
    extra_night: firstCity
      ? {
          name: firstCity.stay,
          inr_sharing: r2(firstCity.cost.double / 2),
          inr_single: firstCity.cost.single,
          usd_sharing: fx ? roundUp((firstCity.cost.double / 2 / fx) * (1 + num(g.markup_pct) / 100), nightTo) : null,
          usd_single: fx ? roundUp((firstCity.cost.single / fx) * (1 + num(g.markup_pct) / 100), nightTo) : null,
        }
      : null,
    totals: t,
    problems,
  };
}

// The group settings coming from the browser, checked (never trusted).
export function sanitizeGroup(raw: unknown): GroupSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number, d: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const money = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e8 ? r2(n) : null;
  };
  const rows: GroupRow[] = Array.isArray(r.rows)
    ? r.rows.slice(0, 30).map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const sell = money(o.sell_usd);
        return { paying: int(o.paying, 1, 60, 6), tls: int(o.tls, 0, 6, 1), jeeps: int(o.jeeps, 0, 40, 1), vehicles: int(o.vehicles, 0, 40, 1), sell_usd: sell && sell > 0 ? sell : null };
      })
    : [];
  const cells: GroupSettings["cells"] = {};
  if (r.cells && typeof r.cells === "object") {
    for (const [k, v] of Object.entries(r.cells as Record<string, unknown>).slice(0, 120)) {
      if (!/^(\d{4}-\d{2}-\d{2}|d\d{1,3})$/.test(k) || !v || typeof v !== "object") continue;
      const c: Partial<Record<CostKind, number>> = {};
      for (const kind of COST_KINDS) {
        const m = money((v as Record<string, unknown>)[kind]);
        if (m != null) c[kind] = m;
      }
      if (Object.keys(c).length) cells[k] = c;
    }
  }
  const fx = money(r.fx);
  const currency = groupCurrency({ currency: r.currency as string });
  return {
    currency,
    paying: int(r.paying, 1, 60, 6),
    tls: int(r.tls, 0, 6, 1),
    tl_room: r.tl_room === "share" ? "share" : "single",
    tl_cost: r.tl_cost === "own_lodges_free" || r.tl_cost === "free" ? r.tl_cost : "divided",
    per_jeep: int(r.per_jeep, 1, 6, 2),
    per_vehicle: int(r.per_vehicle, 1, 12, 3),
    fx: fx && fx > 0 ? fx : null,
    markup_pct: Math.min(100, Math.max(0, num(r.markup_pct))),
    round_to: roundChoices(currency).includes(Number(r.round_to)) ? Number(r.round_to) : currency === "INR" ? 500 : 50,
    rows,
    cells,
    booked_row: r.booked_row == null ? null : int(r.booked_row, 0, 29, 0),
    singles: int(r.singles, 0, 30, 0),
  };
}

// What a saved group quote keeps for the team's page, the guest page and the PDF (no costs): the
// selling price per guest for each group size, the single supplement and the extra night (dollars).
export interface GroupSaved {
  currency?: GroupCurrency; // empty = USD (saved before 8 Nov 2026)
  fx: number | null; // rupees per unit (1 for INR)
  tls: number;
  tl_room: GroupSettings["tl_room"];
  rows: { paying: number; tls: number; jeeps: number; vehicles: number; inr: number; usd: number | null; sell: number | null }[];
  single_supplement: number | null;
  extra_night: { name: string; sharing: number | null; single: number | null } | null;
}
export function toSaved(p: GroupPrice, g: GroupSettings): GroupSaved {
  return {
    currency: groupCurrency(g),
    fx: groupRate(g),
    tls: g.tls,
    tl_room: g.tl_room,
    rows: p.rows.map((r) => ({ paying: r.paying, tls: r.tls, jeeps: r.jeeps, vehicles: r.vehicles, inr: r.inr, usd: r.usd, sell: r.sell })),
    single_supplement: p.single_supplement.sell,
    extra_night: p.extra_night ? { name: p.extra_night.name, sharing: p.extra_night.usd_sharing, single: p.extra_night.usd_single } : null,
  };
}

// The rupee value of a saved group quote, for lists: the first group size's selling price per guest
// x its paying guests x the typed rate. 0 while the rate or the price is missing.
export function groupTotalInr(g: GroupSaved): number {
  const r = g.rows[0];
  if (!r || r.sell == null || !g.fx) return 0;
  return Math.round(r.sell * r.paying * g.fx);
}

// A booked group quote in Payments: the total in US dollars for the group size it booked (the first
// row unless one is chosen) = selling price per guest x paying guests + single supplement x single
// rooms; dues split by the quote's payment percentages, the last one taking the cents so the dues
// add up to the total exactly. null when a price is missing.
export function groupBooking(g: GroupSaved, pcts: { label: string; pct: number }[], bookedRow?: number | null, singles = 0): { total: number; label: string; dues: { label: string; amount: number }[] } | null {
  const r = g.rows[bookedRow ?? 0] ?? g.rows[0];
  if (!r || r.sell == null) return null;
  const s = Math.max(0, Math.floor(singles) || 0);
  if (s > 0 && g.single_supplement == null) return null;
  const total = r2(r.sell * r.paying + (s ? (g.single_supplement ?? 0) * s : 0));
  const parts = pcts.filter((p) => p.pct > 0);
  const sum = parts.reduce((t, p) => t + p.pct, 0);
  const dues: { label: string; amount: number }[] = [];
  let left = total;
  parts.forEach((p, i) => {
    const amt = i === parts.length - 1 ? r2(left) : r2((total * p.pct) / (sum || 100));
    left = r2(left - amt);
    dues.push({ label: p.label, amount: amt });
  });
  return { total, label: `Group ${r.paying} + ${r.tls}${s ? `, ${s} single room${s === 1 ? "" : "s"}` : ""}`, dues };
}

// What the tour operator sees (the guest page): selling prices only, never a cost.
export interface GroupGuest {
  currency?: GroupCurrency;
  rows: { paying: number; tls: number; sell: number | null }[];
  single_supplement: number | null;
  extra_night: { name: string; sharing: number | null; single: number | null } | null;
}
export const toGuest = (g: GroupSaved): GroupGuest => ({
  currency: groupCurrency(g),
  rows: g.rows.map((r) => ({ paying: r.paying, tls: r.tls, sell: r.sell })),
  single_supplement: g.single_supplement,
  extra_night: g.extra_night ? { name: g.extra_night.name, sharing: g.extra_night.sharing, single: g.extra_night.single } : null,
});
