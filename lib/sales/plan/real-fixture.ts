// The owner's real Master data (export of 5 Nov 2026, real-master.data.ts) as the builder and the
// pricing engine see it: the same shape loadBuilderContext / loadPricingData give, so tests run on
// what Pugdundee actually sells, not on made-up rows. The tariff is compiled the way load.ts does
// (lodge exceptions win over it).
// With supabase/sales_itinerary_rules_2026-11-05.sql applied the way it changes the rows (owner,
// 5 Nov 2026): our lodges' "... per BAR policy" rows are for foreign guests only (Indian guests get
// the published Indian tariff), and the circuit's flight routes are in Master data at Rs 15,000.
import type { PricingData } from "@/lib/sales/pricing/types";
import { compileTariff, type TariffRow } from "@/lib/sales/pricing/tariff";
import type { BuilderContext, FlightRoute } from "./types";
import { REAL_MASTER as M } from "./real-master.data";
import { CIRCUIT_FLIGHTS, DOMESTIC_FLIGHT_FARE } from "./travel-rules";

const plain = <T>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
const rooms = plain<{ id: string; property_id: string; name: string; rate_category_id: string | null }[]>(M.rooms);
const tariffRates = compileTariff(plain<TariffRow[]>(M.tariff), plain(M.calendar), plain(M.categories), rooms);

// the SQL of 5 Nov: a "... per BAR policy" row of one of our own lodges, for all guests -> foreign guests
const ownLodge = new Set(M.properties.filter((p) => p.kind === "own_lodge").map((p) => p.id as string));
const roomLodge = new Map(rooms.map((r) => [r.id, r.property_id]));
export const isBarRow = (r: { room_category_id: string; notes?: string | null; nationality?: string | null }) =>
  ownLodge.has(roomLodge.get(r.room_category_id) ?? "") && /per BAR policy/i.test(r.notes ?? "") && (r.nationality ?? "all") === "all";
// the export exactly as it is (before the SQL of 5 Nov): tests that compare before and after
export const roomRatesAsExported = plain<PricingData["roomRates"]>(M.roomRates);
const roomRates = roomRatesAsExported.map((r) => (isBarRow(r as never) ? { ...r, nationality: "foreign" as const } : r));

// Master data > Flight routes after the SQL: every circuit flight at Rs 15,000 per person
export const circuitRoutes: FlightRoute[] = CIRCUIT_FLIGHTS.map(([from_city, to_city], i) => ({
  id: `F${i}`, from_city, to_city, airline: "", flight_no: "", depart_time: "", arrive_time: "", fare: DOMESTIC_FLIGHT_FARE, cabin: "Economy",
}));

const pricing = plain<PricingData>({
  properties: M.properties.map(({ id, name, park_id, kind }) => ({ id, name, park_id, kind })),
  rooms: rooms.map((r) => ({ id: r.id, property_id: r.property_id, name: r.name, max_adults: 2, max_children: 1, extra_bed: true })),
  roomRates: [...roomRates, ...tariffRates],
  parks: M.parks,
  closures: M.closures,
  safariRates: M.safariRates,
  locations: M.locations.map(({ id, name, property_id }) => ({ id, name, property_id })),
  transferRates: M.transferRates,
  addons: M.addons,
  offers: M.offers,
  settings: { markup_pct: 0, fx: { USD: 84 }, payment_slabs: null, flight_fare_pp: DOMESTIC_FLIGHT_FARE },
});

export const realCtx: BuilderContext = {
  pricing,
  properties: plain(M.properties),
  locations: plain(M.locations),
  rooms: rooms.map((r, i) => ({ id: r.id, property_id: r.property_id, name: r.name, sort: i })),
  templates: [],
  content: [],
  cancellation: [],
  flightRoutes: circuitRoutes,
};

// The owner's whole-circuit test enquiry (every destination, activity and transfer he sells).
export const OWNER_FULL_TEST = "Hi team pls make quote - 2 adlts + 1 child 8 yrs from UK, 1 room, arriving delhi on 10th jan'27. delhi one night stay with delhi sighseeing, local guide, accompanying guide and entrances, next day fly to jorhat, kaziranga 3 nigths at iora with 6 safaris and camera, than drive to guwahati and fly to bagdogra, siliguri 2 nights at mayfair chumta jungle view room, than fly bagdogra to delhi, delhi one night stay, then they will go to bhopal than satpura via bhimbetka 3 nights in forest suite with boat safari, canoe, buffer walk, tawa cruise, escorted nature walk, cycling, bush dinner and safari breakfast, than pench 3 nights in tree house room with 1 full day safari, 2 buffer safaris, buffer walk, village walk, cycling, culinary workshop and safari lunch, than tadoba 3 nights at waghoba with 1 full day safari, tadoba boat safari 1 hour, tadoba boat safari 2 hours, core safari from moharli gate, modified gypsy, modified scorpio, cycling, picnic lunch and bush dinner, than kanha 3 nights with 1 full day safari, buffer walk, cycling, special dinner, culinary workshop and picnic lunch, Bandhavgarh, 2 nights kings lodge with full day safari, cycling, village walk and safari breakfast then 2 nights tree house hideaway with bird watching, cycling, bush dinner and escorted nature walk, than ken river 3 nights with boat safari, night boat safari, half day fishing, full day fishing, island dinner, bush dinner, cycling, royal enfield and nature walk, than khajuraho 1 night with sightseeing guide and entrances, transfer to khajuraho for delhi flight drive direct to Agra for 2 nights stay with Agra sighseeing and local guide, than drive to jaipur 2 nights at itc rajputana with jaipur sightseeing, drive back to delhi for homebound flight. 2 gaadi for all transfers, sab safari naturalist ke saath and if any lodge is having unique expeirence add that also";
