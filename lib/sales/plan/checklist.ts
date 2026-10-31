// The trip checklist the assistant shows the sales person after every message:
// a tick for each detail that is understood, a question for each one that is missing
// or unclear (asked, never guessed). Pure, so it is tested with the reader.
import { countryName } from "@/lib/sales/countries";
import { fmtDate } from "@/lib/sales/format";
import { lodgesInPark, roomsOf } from "./planner";
import { safariOnly, stayKey, stayWhere } from "./cities";
import type { BuilderContext, Plan, PlanStop, TravelMode } from "./types";
import type { ChatFlags } from "./chat";

export interface CheckItem {
  key: string; // "guests", "nationality", "date", "arrival", "stop:0", "between", "city:0", "departure", "requests", "ask:<key>"
  label: string;
  ok: boolean;
  text: string; // what was understood, or the question
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const MODE: Record<TravelMode, string> = { flight: "flight", train: "train", own: "own vehicle", transfer: "our transfer" };

export function tripChecklist(plan: Plan, f: ChatFlags, full: BuilderContext): CheckItem[] {
  const ctx = safariOnly(full);
  const items: CheckItem[] = [];
  const g = plan.guest;
  const place = (id: string | null) => (id ? ctx.locations.find((l) => l.id === id)?.name ?? "" : "");
  const parkName = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? "the park";

  items.push(
    f.adultsSet
      ? { key: "guests", label: "Guests", ok: true, text: `${plural(g.adults, "adult")}${g.children.length ? `, ${g.children.length === 1 ? "child" : "children"} aged ${g.children.join(", ")}` : ""}, ${plural(g.rooms, "room")}` }
      : { key: "guests", label: "Guests", ok: false, text: "How many adults, and children with their ages?" }
  );
  items.push(
    f.nationalitySet || g.country
      ? { key: "nationality", label: "Nationality", ok: true, text: g.country ? countryName(g.country) || g.country : g.nationality === "indian" ? "Indian" : "Foreign nationals" }
      : { key: "nationality", label: "Nationality", ok: false, text: "Indian or foreign nationals? Room and safari rates differ." }
  );
  const dateAsk = (f.asks ?? []).find((a) => a.key === "date");
  items.push(
    plan.dateless
      ? { key: "date", label: "Arrival date", ok: true, text: "Dates not fixed: priced by season" }
      : f.dateSet
        ? { key: "date", label: "Arrival date", ok: true, text: fmtDate(plan.arrival_date) }
        : { key: "date", label: "Arrival date", ok: false, text: dateAsk?.text ?? "When do they arrive?" }
  );

  // the way in
  const arrMode = plan.own_vehicle ? "own" : plan.arrival_mode;
  const arrPlace = place(plan.arrival_location_id);
  items.push(
    arrMode === "own"
      ? { key: "arrival", label: "Arrival", ok: true, text: "In their own vehicle (no transfer)" }
      : arrPlace
        ? { key: "arrival", label: "Arrival", ok: true, text: `${arrPlace}${arrMode ? ` (${MODE[arrMode]})` : ""}, our transfer to the lodge` }
        : f.arrivalAsked
          ? { key: "arrival", label: "Arrival", ok: true, text: "On their own (no pick-up)" }
          : { key: "arrival", label: "Arrival", ok: false, text: "Where does our car pick them up for the safari part (airport, station), or do they come in their own vehicle?" }
  );

  // each stop
  plan.stops.forEach((s, i) => {
    const lodge = ctx.properties.find((p) => p.id === s.property_id)?.name ?? "";
    const room = ctx.rooms.find((r) => r.id === s.room_category_id)?.name ?? "";
    const questions: string[] = [];
    if (f.nightsUnknown.includes(s.park_id)) questions.push("how many nights?");
    if (lodgesInPark(ctx, s.park_id).length > 1 && !(f.lodgeDecided ?? []).includes(s.park_id)) questions.push(`which lodge (${lodgesInPark(ctx, s.park_id).map((l) => l.name).join(" or ")})?`);
    else if (roomsOf(ctx, s.property_id).length > 1 && !(f.roomDecided ?? []).includes(s.park_id)) questions.push(`which room (${roomsOf(ctx, s.property_id).map((r) => r.name).join(" or ")})?`);
    const label = parkName(s.park_id).split(/[ -]/)[0];
    items.push({
      key: `stop:${i}`,
      label: `Stop ${i + 1}: ${label}`,
      ok: !questions.length,
      text: questions.length ? `${lodge || label}: ${questions.join(" ")}` : stopText(s, lodge, room),
    });
  });

  // between the lodges
  if (plan.stops.length > 1) {
    const ownSomewhere = plan.arrival_mode === "own" || plan.departure_mode === "own";
    items.push(
      plan.own_vehicle || plan.between_lodges === "own"
        ? { key: "between", label: "Between lodges", ok: true, text: "Their own vehicle (no transfer charge)" }
        : plan.between_lodges === "ours" || !ownSomewhere
          ? { key: "between", label: "Between lodges", ok: true, text: "Our car" }
          : { key: "between", label: "Between lodges", ok: false, text: "Our car, or their own vehicle?" }
    );
  }

  // nights in a city, with the hotel
  (plan.city_stays ?? []).forEach((c, i) => {
    const where = `${c.city || "Added day"}, ${plural(c.nights, "night")} ${stayWhere(c, plan.stops, full.pricing.parks)}`;
    const asked = (f.hotelAsked ?? []).includes(stayKey(c));
    items.push(
      c.hotel || asked
        ? { key: `city:${i}`, label: "City nights", ok: true, text: `${where}: ${c.hotel || "hotel to be confirmed"}` }
        : { key: `city:${i}`, label: "City nights", ok: false, text: `${where}: which hotel?` }
    );
  });

  // the way out
  const depMode = plan.own_vehicle ? "own" : plan.departure_mode;
  const depPlace = place(plan.departure_location_id);
  items.push(
    depMode === "own"
      ? { key: "departure", label: "Departure", ok: true, text: "In their own vehicle (no transfer)" }
      : depPlace
        ? { key: "departure", label: "Departure", ok: true, text: `${depPlace}${depMode ? ` (${MODE[depMode]})` : ""}, our drop from the lodge` }
        : f.departureAsked
          ? { key: "departure", label: "Departure", ok: true, text: "On their own (no drop)" }
          : { key: "departure", label: "Departure", ok: false, text: "Where do they leave from, and how?" }
  );

  items.push({ key: "requests", label: "Special requests", ok: true, text: plan.requests?.length ? plan.requests.join(", ") : "None mentioned" });

  for (const a of f.asks ?? []) {
    if (a.key === "date") continue; // shown on the date line
    items.push({ key: `ask:${a.key}`, label: "To ask", ok: false, text: a.text });
  }
  return items;
}

function stopText(s: PlanStop, lodge: string, room: string) {
  const parts = [`${lodge}, ${plural(s.nights, "night")}${room ? `, ${room}` : ""}`];
  const saf = s.want_safaris == null ? "safaris as many as fit" : s.want_safaris === 0 ? "no safaris" : plural(s.want_safaris, "safari");
  parts.push(saf + (s.want_sessions ? ` (${s.want_sessions === "morning" ? "mornings" : "evenings"} only)` : "") + (s.want_jeeps ? `, ${plural(s.want_jeeps, "jeep")} each` : ""));
  if (s.want_naturalists) parts.push(s.want_naturalists < 0 ? "naturalist on every safari" : `naturalist on ${plural(s.want_naturalists, "safari")}`);
  const extras = (s.want_extras ?? []).map((x) => (x === "special" ? "the lodge's own experiences" : `${x}${s.want_qty?.[x] ? ` x${s.want_qty[x]}` : ""}`));
  if (extras.length) parts.push(extras.join(", "));
  return parts.join("; ");
}
