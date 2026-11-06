// Red Panda: server-side access checks and the Master data loader. Every Red Panda page calls
// requireRpUser() / requireRpEditor(); every server action calls rpActor() / rpEditor(). The
// database checks again (RLS and rp_* functions), so these are the first of two locks.
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser, getCurrentUser, homePathFor, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NO_RP, readAccess, type RpAccess } from "./access";
import { readSettings } from "./plan";
import type { Market, RpFlight, RpHotel, RpMaster, RpSupplementRow, RpTariffRow } from "./types";

// One call per request (layout and page share it). Tables not there yet (SQL not run) or any
// failure = no access: the tab stays hidden.
export const rpStatus = cache(async (role: string | null | undefined): Promise<RpAccess> => {
  if (!isSalesUser(role)) return NO_RP; // no extra call for Lodge Reporting and trip report accounts
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rp_my_access");
    if (error) return NO_RP;
    return readAccess(data, role);
  } catch {
    return NO_RP;
  }
});

export async function requireRpUser() {
  const { user, profile } = await requireUser();
  const access = await rpStatus(profile?.role);
  if (!access.canUse) redirect(homePathFor(profile?.role));
  return { user, profile, access };
}

export async function requireRpEditor() {
  const r = await requireRpUser();
  if (!r.access.isEditor) redirect("/red-panda");
  return r;
}

type Denied = { error: string };
export async function rpActor(): Promise<Denied | { userId: string; role: string; access: RpAccess }> {
  const cu = await getCurrentUser();
  if (!cu?.user) return { error: "Please sign in again." };
  const access = await rpStatus(cu.profile?.role);
  if (!access.canUse) return { error: "You do not have access to Red Panda." };
  return { userId: cu.user.id, role: String(cu.profile?.role ?? ""), access };
}

export async function rpEditor(): Promise<Denied | { userId: string }> {
  const a = await rpActor();
  if ("error" in a) return a;
  if (!a.access.isEditor) return { error: "Only the super admin can change Red Panda Master data." };
  return { userId: a.userId };
}

type Row = Record<string, unknown>;
const d10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");

// The tariff, supplements, settings and the partner hotel near Bagdogra (from Sales Master data).
export async function loadRpMaster(): Promise<{ master: RpMaster | null; error?: string }> {
  const supabase = await createClient();
  const [t, s, st, props] = await Promise.all([
    supabase.from("rp_tariff").select("season, valid_from, valid_to, market, guests, per_pax, active").eq("active", true),
    supabase.from("rp_supplements").select("season, valid_from, valid_to, market, kind, amount, active").eq("active", true),
    supabase.from("rp_settings").select("data").eq("id", 1).maybeSingle(),
    supabase.from("sales_properties").select("id, name, kind, city, park_id, fallback_priority").eq("active", true).order("fallback_priority"),
  ]);
  if (t.error || s.error || st.error) return { master: null, error: (t.error ?? s.error ?? st.error)!.message };
  const settings = readSettings((st.data as { data?: unknown } | null)?.data);
  const tariff: RpTariffRow[] = ((t.data ?? []) as Row[]).map((r) => ({
    season: String(r.season), valid_from: d10(r.valid_from), valid_to: d10(r.valid_to), market: r.market as Market, guests: Number(r.guests), per_pax: Number(r.per_pax), active: r.active !== false,
  }));
  const supplements: RpSupplementRow[] = ((s.data ?? []) as Row[]).map((r) => ({
    season: String(r.season), valid_from: d10(r.valid_from), valid_to: d10(r.valid_to), market: r.market as Market, kind: r.kind as RpSupplementRow["kind"], amount: Number(r.amount), active: r.active !== false,
  }));

  // Sales Master data: places, the partner hotel near Bagdogra ("Mayfair" in settings), Delhi's city
  // hotels, their rooms, rates and airport transfers, and the Delhi - Bagdogra flights
  const [locs, flights, parks] = await Promise.all([
    supabase.from("sales_locations").select("id, name, type, code, property_id").eq("active", true),
    supabase.from("sales_flight_routes").select("from_city, to_city, airline, flight_no, depart_time, arrive_time, fare, sort").eq("active", true).order("sort"),
    supabase.from("sales_parks").select("id, name"),
  ]);
  const parkName = new Map(((parks.data ?? []) as Row[]).map((x) => [String(x.id), String(x.name).trim().toLowerCase()]));
  const propRows: Row[] = ((props.data ?? []) as Row[]).map((p) => ({ ...p, park_name: parkName.get(String(p.park_id ?? "")) ?? "" }));
  const locRows = (locs.data ?? []) as Row[];
  const airportIds = (re: RegExp, code: string) => locRows.filter((l) => String(l.code ?? "").toUpperCase() === code || (String(l.type) === "airport" && re.test(String(l.name)))).map((l) => String(l.id));
  const bagdogra = airportIds(/bagdogra/i, "IXB");
  const delhiAirport = airportIds(/^delhi/i, "DEL");

  async function loadHotel(prop: Row, airports: string[]): Promise<RpHotel> {
    const pid = String(prop.id);
    const { data: rooms } = await supabase.from("sales_room_categories").select("id, name, sort").eq("property_id", pid).eq("active", true).order("sort");
    const roomRows = (rooms ?? []) as Row[];
    const ids = roomRows.map((r) => String(r.id));
    const hotelLoc = locRows.filter((l) => String(l.property_id ?? "") === pid).map((l) => String(l.id));
    const [rates, tr] = await Promise.all([
      ids.length
        ? supabase.from("sales_room_rates").select("room_category_id, valid_from, valid_to, meal_plan, rate_single, rate_double, tax_pct, rates_include_tax, active").in("room_category_id", ids).eq("active", true)
        : Promise.resolve({ data: [] as Row[] }),
      hotelLoc.length && airports.length
        ? supabase.from("sales_transfer_rates").select("from_location_id, to_location_id, vehicle_type, capacity, rate, tax_pct, valid_from, valid_to, active").eq("active", true).in("from_location_id", [...hotelLoc, ...airports])
        : Promise.resolve({ data: [] as Row[] }),
    ]);
    const joins = ((tr.data ?? []) as Row[]).filter(
      (r) => (hotelLoc.includes(String(r.from_location_id)) && airports.includes(String(r.to_location_id))) || (airports.includes(String(r.from_location_id)) && hotelLoc.includes(String(r.to_location_id)))
    );
    const pick = joins.sort((x, y) => Number(x.rate) - Number(y.rate))[0]; // the cheapest car on that road
    return {
      property_id: pid,
      name: String(prop.name),
      rooms: roomRows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        rates: ((rates.data ?? []) as Row[])
          .filter((x) => String(x.room_category_id) === String(r.id))
          .map((x) => ({
            valid_from: d10(x.valid_from),
            valid_to: d10(x.valid_to),
            meal_plan: String(x.meal_plan ?? ""),
            rate_single: x.rate_single == null ? null : Number(x.rate_single),
            rate_double: Number(x.rate_double),
            tax_pct: Number(x.tax_pct ?? 0),
            rates_include_tax: x.rates_include_tax === true,
          })),
      })),
      transfer: pick
        ? { rate: Number(pick.rate), tax_pct: Number(pick.tax_pct ?? 0), capacity: Math.max(1, Number(pick.capacity) || 4), vehicle_type: String(pick.vehicle_type ?? "car"), valid_from: pick.valid_from ? d10(pick.valid_from) : null, valid_to: pick.valid_to ? d10(pick.valid_to) : null }
        : null,
    };
  }

  const want = settings.hotel_property.trim().toLowerCase();
  const prop = want ? propRows.find((p) => String(p.name).toLowerCase().includes(want)) : undefined;
  // Delhi's hotels: city hotels in Delhi (by their city, or their place in Parks named Delhi)
  const delhiProps = propRows.filter((p) => String(p.kind) === "city_hotel" && (/^\s*(new\s+)?delhi\b/i.test(String(p.city ?? "")) || String(p.park_name ?? "") === "delhi"));
  const flightRows = (flights.data ?? []) as Row[];
  const flight = (from: RegExp, to: RegExp): RpFlight | null => {
    const f = flightRows.find((x) => from.test(String(x.from_city)) && to.test(String(x.to_city)) && Number(x.fare) >= 0);
    return f ? { from: String(f.from_city), to: String(f.to_city), fare: Number(f.fare), airline: String(f.airline ?? ""), flight_no: String(f.flight_no ?? ""), depart: String(f.depart_time ?? "").slice(0, 5), arrive: String(f.arrive_time ?? "").slice(0, 5) } : null;
  };
  const [hotel, delhiHotels] = await Promise.all([prop ? loadHotel(prop, bagdogra) : Promise.resolve(null), Promise.all(delhiProps.map((p) => loadHotel(p, delhiAirport)))]);
  const delhi = { hotels: delhiHotels.filter((h) => h.rooms.length > 0), out: flight(/^delhi/i, /^bagdogra/i), back: flight(/^bagdogra/i, /^delhi/i) };
  return { master: { tariff, supplements, settings, hotel, delhi } };
}
