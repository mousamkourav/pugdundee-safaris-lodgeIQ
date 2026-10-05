// Rebuilds a plan from untrusted JSON (the browser) keeping only known keys
// with the right types. Anything malformed becomes a safe default.
import type { DaySafari, Plan, PlanDay, PlanStop } from "./types";

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 100) : null);
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fallback;
};
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function sanitizePlan(input: unknown): Plan | null {
  const p = obj(input);
  const g = obj(p.guest);
  if (!isDate(p.arrival_date)) return null;

  const stops: PlanStop[] = (Array.isArray(p.stops) ? p.stops : []).slice(0, 20).map((x) => {
    const s = obj(x);
    return {
      park_id: str(s.park_id, 100),
      nights: int(s.nights, 1, 60, 1),
      property_id: str(s.property_id, 100),
      room_category_id: str(s.room_category_id, 100),
      meal_plan: ["EP", "CP", "MAP", "AP"].includes(String(s.meal_plan)) ? String(s.meal_plan) : "AP",
    };
  });

  const days: PlanDay[] = (Array.isArray(p.days) ? p.days : []).slice(0, 120).map((x) => {
    const d = obj(x);
    const t = obj(d.transfer);
    const safaris: DaySafari[] = (Array.isArray(d.safaris) ? d.safaris : [])
      .map((y) => obj(y))
      .filter((y) => (y.session === "morning" || y.session === "afternoon") && (y.zone === "core" || y.zone === "buffer"))
      .map((y) => ({ session: y.session as DaySafari["session"], zone: y.zone as DaySafari["zone"] }))
      .slice(0, 2);
    const kind = ["arrival", "safari", "transfer", "leisure", "departure"].includes(String(d.kind)) ? (d.kind as PlanDay["kind"]) : "leisure";
    return {
      date: isDate(d.date) ? d.date : (p.arrival_date as string),
      kind,
      property_id: strOrNull(d.property_id),
      park_id: strOrNull(d.park_id),
      safaris,
      transfer: t.from_location_id && t.to_location_id ? { from_location_id: str(t.from_location_id, 100), to_location_id: str(t.to_location_id, 100) } : null,
      title: str(d.title, 200),
      text: str(d.text, 4000),
      notes: (Array.isArray(d.notes) ? d.notes : []).map((z) => str(z, 300)).slice(0, 10),
    };
  });

  const adj = obj(p.adjustment);
  const adjAmount = Number(adj.amount);

  return {
    schema_version: 1,
    guest: {
      name: str(g.name, 200).trim(),
      email: str(g.email, 200).trim(),
      phone: str(g.phone, 50).trim(),
      nationality: g.nationality === "indian" ? "indian" : "foreign",
      adults: int(g.adults, 1, 50, 2),
      children: (Array.isArray(g.children) ? g.children : []).map((a) => int(a, 0, 17, 0)).slice(0, 20),
      rooms: int(g.rooms, 1, 30, 1),
      source: str(g.source, 100),
      agent_name: str(g.agent_name, 200),
      notes: str(g.notes, 2000),
    },
    arrival_date: p.arrival_date,
    arrival_location_id: strOrNull(p.arrival_location_id),
    departure_location_id: strOrNull(p.departure_location_id),
    stops,
    days,
    vehicle_type: strOrNull(p.vehicle_type),
    offer_ids: (Array.isArray(p.offer_ids) ? p.offer_ids : []).map((x) => str(x, 100)).filter(Boolean).slice(0, 5),
    markup_pct: p.markup_pct === null || p.markup_pct === undefined || p.markup_pct === "" ? null : Math.max(-50, Math.min(200, Number(p.markup_pct) || 0)),
    adjustment: Number.isFinite(adjAmount) && adjAmount !== 0 ? { amount: Math.round(adjAmount), reason: str(adj.reason, 300).trim() } : null,
    currency: p.currency === "USD" ? "USD" : "INR",
  };
}
