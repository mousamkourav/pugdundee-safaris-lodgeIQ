// The owner's real Master data (export of 2 Nov 2026, real-master.data.ts) as the builder and the
// pricing engine see it: the same shape loadBuilderContext / loadPricingData give, so tests run on
// what Pugdundee actually sells, not on made-up rows. The tariff is compiled the way load.ts does
// (lodge exceptions win over it). Flight routes are not in the export: none here.
import type { PricingData } from "@/lib/sales/pricing/types";
import { compileTariff, type TariffRow } from "@/lib/sales/pricing/tariff";
import type { BuilderContext } from "./types";
import { REAL_MASTER as M } from "./real-master.data";

const plain = <T>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
const rooms = plain<{ id: string; property_id: string; name: string; rate_category_id: string | null }[]>(M.rooms);
const tariffRates = compileTariff(plain<TariffRow[]>(M.tariff), plain(M.calendar), plain(M.categories), rooms);

const pricing = plain<PricingData>({
  properties: M.properties.map(({ id, name, park_id, kind }) => ({ id, name, park_id, kind })),
  rooms: rooms.map((r) => ({ id: r.id, property_id: r.property_id, name: r.name, max_adults: 2, max_children: 1, extra_bed: true })),
  roomRates: [...plain<PricingData["roomRates"]>(M.roomRates), ...tariffRates],
  parks: M.parks,
  closures: M.closures,
  safariRates: M.safariRates,
  locations: M.locations.map(({ id, name, property_id }) => ({ id, name, property_id })),
  transferRates: M.transferRates,
  addons: M.addons,
  offers: M.offers,
  settings: { markup_pct: 0, fx: { USD: 84 }, payment_slabs: null },
});

export const realCtx: BuilderContext = {
  pricing,
  properties: plain(M.properties),
  locations: plain(M.locations),
  rooms: rooms.map((r, i) => ({ id: r.id, property_id: r.property_id, name: r.name, sort: i })),
  templates: [],
  content: [],
  cancellation: [],
};
