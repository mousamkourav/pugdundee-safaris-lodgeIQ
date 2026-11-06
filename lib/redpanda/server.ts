// Red Panda: server-side access checks and the Master data loader. Every Red Panda page calls
// requireRpUser() / requireRpEditor(); every server action calls rpActor() / rpEditor(). The
// database checks again (RLS and rp_* functions), so these are the first of two locks.
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser, getCurrentUser, homePathFor, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NO_RP, readAccess, type RpAccess } from "./access";
import { readSettings } from "./plan";
import type { Market, RpHotel, RpMaster, RpSupplementRow, RpTariffRow } from "./types";
import type { RpSalesPricing } from "./in-sales";

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
    supabase.from("sales_properties").select("id, name").eq("active", true),
  ]);
  if (t.error || s.error || st.error) return { master: null, error: (t.error ?? s.error ?? st.error)!.message };
  const settings = readSettings((st.data as { data?: unknown } | null)?.data);
  const tariff: RpTariffRow[] = ((t.data ?? []) as Row[]).map((r) => ({
    season: String(r.season), valid_from: d10(r.valid_from), valid_to: d10(r.valid_to), market: r.market as Market, guests: Number(r.guests), per_pax: Number(r.per_pax), active: r.active !== false,
  }));
  const supplements: RpSupplementRow[] = ((s.data ?? []) as Row[]).map((r) => ({
    season: String(r.season), valid_from: d10(r.valid_from), valid_to: d10(r.valid_to), market: r.market as Market, kind: r.kind as RpSupplementRow["kind"], amount: Number(r.amount), active: r.active !== false,
  }));

  // the partner hotel: the active Sales property whose name has settings.hotel_property ("Mayfair")
  let hotel: RpHotel | null = null;
  const want = settings.hotel_property.trim().toLowerCase();
  const prop = want ? ((props.data ?? []) as Row[]).find((p) => String(p.name).toLowerCase().includes(want)) : undefined;
  if (prop) {
    const pid = String(prop.id);
    const [rooms, locs] = await Promise.all([
      supabase.from("sales_room_categories").select("id, name, sort").eq("property_id", pid).eq("active", true).order("sort"),
      supabase.from("sales_locations").select("id, name, type, code, property_id").eq("active", true),
    ]);
    const roomRows = (rooms.data ?? []) as Row[];
    const ids = roomRows.map((r) => String(r.id));
    const rates = ids.length
      ? await supabase.from("sales_room_rates").select("room_category_id, valid_from, valid_to, meal_plan, rate_single, rate_double, tax_pct, rates_include_tax, active").in("room_category_id", ids).eq("active", true)
      : { data: [] };
    const locRows = (locs.data ?? []) as Row[];
    const hotelLoc = locRows.filter((l) => String(l.property_id ?? "") === pid).map((l) => String(l.id));
    const bagdogra = locRows.filter((l) => String(l.code ?? "").toUpperCase() === "IXB" || /bagdogra/i.test(String(l.name))).map((l) => String(l.id));
    let transfer: RpHotel["transfer"] = null;
    if (hotelLoc.length && bagdogra.length) {
      const { data: tr } = await supabase
        .from("sales_transfer_rates")
        .select("from_location_id, to_location_id, vehicle_type, capacity, rate, tax_pct, valid_from, valid_to, bidirectional, active")
        .eq("active", true)
        .in("from_location_id", [...hotelLoc, ...bagdogra]);
      const joins = ((tr ?? []) as Row[]).filter(
        (r) =>
          (hotelLoc.includes(String(r.from_location_id)) && bagdogra.includes(String(r.to_location_id))) ||
          (bagdogra.includes(String(r.from_location_id)) && hotelLoc.includes(String(r.to_location_id)))
      );
      // the cheapest car on that road
      const pick = joins.sort((a, b) => Number(a.rate) - Number(b.rate))[0];
      if (pick)
        transfer = {
          rate: Number(pick.rate),
          tax_pct: Number(pick.tax_pct ?? 0),
          capacity: Math.max(1, Number(pick.capacity) || 4),
          vehicle_type: String(pick.vehicle_type ?? "car"),
          valid_from: pick.valid_from ? d10(pick.valid_from) : null,
          valid_to: pick.valid_to ? d10(pick.valid_to) : null,
        };
    }
    hotel = {
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
      transfer,
    };
  }
  return { master: { tariff, supplements, settings, hotel } };
}

// The Red Panda tariff for the Sales builder and its save (a Red Panda stop in a Safari trip):
// only for people with Red Panda access; anyone else gets null (the stop is then an error).
export async function loadRpSalesPricing(role: string | null | undefined): Promise<RpSalesPricing | null> {
  const access = await rpStatus(role);
  if (!access.canUse) return null;
  const { master } = await loadRpMaster();
  if (!master) return null;
  const s = master.settings;
  return { tariff: master.tariff, supplements: master.supplements, gst_pct: s.gst_pct, package_nights: s.package_nights, min_nights: s.min_nights, max_guests: s.max_guests, min_age: s.min_age, closed_months: s.closed_months };
}

// The Sales builder context with the Red Panda tariff (a new object: the cached one is shared).
export async function withRedPanda<T extends { pricing: object }>(ctx: T, role: string | null | undefined): Promise<T> {
  const redPanda = await loadRpSalesPricing(role);
  return { ...ctx, pricing: { ...ctx.pricing, redPanda } };
}
