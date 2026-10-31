// =====================================================================
// "Missing transfer rates" (Master data): every road a quote can need that has no rate,
// so management can fill them in once instead of the sales team typing a price each time.
//   - lodge <-> lodge: every pair of our own lodges (one road, both directions)
//   - lodge <-> airport / station: the gateways of its park (a place that already has a
//     rate to another lodge in the same park: Jabalpur for Kings Lodge -> also for Tree House)
//   - city hotel <-> its city's airport and station
//   - every road that saved quotes needed and had no rate for (a price typed by hand)
// A rate entered in either direction covers the road (the engine uses it both ways).
// Sorted by how often quotes needed it. Pure, so it is tested without a database.
// =====================================================================

export interface MtProperty {
  id: string;
  name: string;
  park_id: string | null;
  kind: string; // own_lodge, partner_lodge, city_hotel
  city?: string | null;
}
export interface MtLocation {
  id: string;
  name: string;
  type: string; // airport, railway, city, other, property
  property_id: string | null;
}
export interface MtRate {
  from_location_id: string;
  to_location_id: string;
  active?: boolean;
}
// A transfer a saved quote had no rate for (from pricing.missing), with the price typed if any.
export interface QuoteMiss {
  from: string;
  to: string;
  price?: number | null;
}

export type PairKind = "lodge-lodge" | "lodge-place" | "hotel-place" | "quote";
export interface MissingPair {
  from_id: string;
  to_id: string;
  from_name: string;
  to_name: string;
  kind: PairKind;
  needed: number; // times saved quotes needed it
  last_price: number | null; // the last price typed for it in a quote (a hint for management)
}

export const PAIR_KIND_LABEL: Record<PairKind, string> = {
  "lodge-lodge": "Lodge to lodge",
  "lodge-place": "Lodge to airport / station",
  "hotel-place": "City hotel to airport / station",
  quote: "Needed in a quote",
};

const roadKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Is there an active rate for this road, in either direction?
export function hasRoad(rates: MtRate[], a: string, b: string): boolean {
  return rates.some((r) => r.active !== false && ((r.from_location_id === a && r.to_location_id === b) || (r.from_location_id === b && r.to_location_id === a)));
}

// The from / to of a missing transfer key from the engine: "transfer|2027-01-16|NAG|L_WEL".
export function parseTransferKey(key: string): { from: string; to: string } | null {
  const m = key.match(/^transfer\|[^|]*\|([^|]+)\|([^|]+)$/);
  return m ? { from: m[1], to: m[2] } : null;
}

export function missingTransferPairs(input: { properties: MtProperty[]; locations: MtLocation[]; rates: MtRate[]; quoteMisses: QuoteMiss[] }): MissingPair[] {
  const { properties, locations, rates } = input;
  const locById = new Map(locations.map((l) => [l.id, l]));
  const locOfProperty = new Map(locations.filter((l) => l.property_id).map((l) => [l.property_id!, l]));
  const places = locations.filter((l) => l.type === "airport" || l.type === "railway");
  const out = new Map<string, MissingPair>();

  const add = (fromId: string, toId: string, kind: PairKind) => {
    if (fromId === toId || fromId.startsWith("@") || toId.startsWith("@")) return null;
    const from = locById.get(fromId);
    const to = locById.get(toId);
    if (!from || !to || hasRoad(rates, fromId, toId)) return null;
    const k = roadKey(fromId, toId);
    const have = out.get(k);
    if (have) return have;
    const p: MissingPair = { from_id: fromId, to_id: toId, from_name: from.name, to_name: to.name, kind, needed: 0, last_price: null };
    out.set(k, p);
    return p;
  };

  // lodge <-> lodge (our own lodges)
  const own = properties.filter((p) => p.kind === "own_lodge" && locOfProperty.has(p.id));
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) add(locOfProperty.get(own[i].id)!.id, locOfProperty.get(own[j].id)!.id, "lodge-lodge");

  // lodge <-> the gateways of its park
  const lodges = properties.filter((p) => (p.kind === "own_lodge" || p.kind === "partner_lodge") && p.park_id && locOfProperty.has(p.id));
  for (const lodge of lodges) {
    const here = locOfProperty.get(lodge.id)!.id;
    const sameParkLocs = new Set(lodges.filter((l) => l.park_id === lodge.park_id).map((l) => locOfProperty.get(l.id)!.id));
    const gateways = places.filter((pl) => [...sameParkLocs].some((loc) => hasRoad(rates, pl.id, loc)));
    for (const g of gateways) add(g.id, here, "lodge-place");
  }

  // city hotel <-> its city's airport and station
  for (const h of properties.filter((p) => p.kind === "city_hotel" && p.city && locOfProperty.has(p.id))) {
    const city = h.city!.toLowerCase().trim();
    for (const pl of places.filter((x) => x.name.toLowerCase().includes(city))) add(pl.id, locOfProperty.get(h.id)!.id, "hotel-place");
  }

  // what saved quotes needed: counted (both directions are one road), with the last price typed
  for (const q of input.quoteMisses) {
    const p = add(q.from, q.to, "quote") ?? out.get(roadKey(q.from, q.to));
    if (!p) continue;
    p.needed++;
    if (typeof q.price === "number" && q.price > 0) p.last_price = q.price;
  }

  const order: PairKind[] = ["quote", "lodge-place", "lodge-lodge", "hotel-place"];
  return [...out.values()].sort((a, b) => b.needed - a.needed || order.indexOf(a.kind) - order.indexOf(b.kind) || a.from_name.localeCompare(b.from_name) || a.to_name.localeCompare(b.to_name));
}

// The transfers a saved version had no rate for, from its pricing (missing) and plan
// (the price typed by hand), oldest version first so the last typed price wins.
export function quoteMissesOf(versions: { missing?: unknown; manual?: unknown }[]): QuoteMiss[] {
  const out: QuoteMiss[] = [];
  for (const v of versions) {
    const manual = (v.manual && typeof v.manual === "object" ? v.manual : {}) as Record<string, unknown>;
    for (const m of Array.isArray(v.missing) ? v.missing : []) {
      const key = (m as { key?: unknown; kind?: unknown })?.key;
      if ((m as { kind?: unknown }).kind !== "transfer" || typeof key !== "string") continue;
      const road = parseTransferKey(key);
      if (!road) continue;
      const price = Number(manual[key]);
      out.push({ ...road, price: Number.isFinite(price) && price > 0 ? price : null });
    }
  }
  return out;
}
