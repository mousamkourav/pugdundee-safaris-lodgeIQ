// What the assistant does with a reading (pure; tested in reader.test.ts): fills the quote, says in
// plain words what it understood, and asks for what is still missing, one question at a time.
// Also the Confirm step's plain-words trip, its one-click fixes, and the confirmation key the
// server checks before a quote goes to the guest.
import type { RpReading, RpPending } from "./reader";
import type { RpPlan, RpSettings } from "./types";

const DATE = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const fmtD = (d: string | null) => (d ? DATE.format(new Date(`${d}T00:00:00Z`)) : "not set");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export interface AssistReply {
  plan: RpPlan;
  understood: string[];
  question: string | null;
  pending: RpPending;
  ready: boolean; // everything needed for a price is there
}

export type DelhiHotelOpt = { id: string; name: string; rooms: { id: string; name: string }[] };

export function applyReading(plan: RpPlan, r: RpReading, s: RpSettings, hotelRooms: { id: string; name: string }[] = [], delhiHotels: DelhiHotelOpt[] = []): AssistReply {
  const p: RpPlan = { ...plan, guest: { ...plan.guest }, hotel_before: { ...plan.hotel_before }, hotel_after: { ...plan.hotel_after }, delhi_before: { ...plan.delhi_before }, delhi_after: { ...plan.delhi_after } };
  const u: string[] = [];
  const air = (c: string) => s.airports.find((a) => a.code === c)?.name.replace(/\s*\(.*$/, "") ?? c;
  if (r.name) {
    p.guest.name = r.name;
    u.push(`Guest: ${r.name}`);
  }
  if (r.email) p.guest.email = r.email;
  if (r.phone) p.guest.phone = r.phone;
  if (r.adults != null) {
    p.guest.adults = r.adults;
    u.push(plural(r.adults, "adult"));
  }
  if (r.child_ages) {
    p.guest.child_ages = r.child_ages;
    u.push(`children aged ${r.child_ages.join(", ")}`);
  }
  if (r.nationality) {
    p.guest.nationality = r.nationality;
    if (r.country) p.guest.country = r.country;
    else if (r.nationality === "indian") p.guest.country = "India";
    u.push(r.country ? `from ${r.country}` : r.nationality === "indian" ? "Indian" : "foreign");
  }
  if (r.booked_by) {
    p.guest.booked_by = r.booked_by;
    if (r.agent_name) p.guest.agent_name = r.agent_name;
    u.push(r.booked_by === "agent" ? `through an agent${r.agent_name ? ` (${r.agent_name})` : ""}: B2B tariff` : "direct guest");
  }
  if (r.arrival) {
    p.arrival = r.arrival;
    delete p.dateless;
    delete p.rate_season;
    u.push(`arriving ${fmtD(r.arrival)}`);
  } else if (r.dateless) {
    // "dates not fixed": priced on the newest season's tariff until a date is given
    p.dateless = true;
    p.arrival = null;
    u.push("dates not fixed yet (priced on the season's tariff)");
  }
  if (r.nights != null) {
    p.nights = r.nights;
    u.push(`${plural(r.nights, "night")} at Red Panda Outpost`);
  }
  if (r.arrive_airport) p.arrive_airport = r.arrive_airport;
  if (r.depart_airport) p.depart_airport = r.depart_airport;
  if (r.arrive_airport || r.depart_airport) u.push(p.arrive_airport === p.depart_airport ? `${air(p.arrive_airport)} both ways` : `in at ${air(p.arrive_airport)}, out at ${air(p.depart_airport)}`);
  if (r.rooms != null) {
    p.guest.rooms = r.rooms;
    u.push(plural(r.rooms, "room"));
  }
  if (r.tour_leader) {
    p.tour_leader = true;
    u.push("a tour leader");
  }
  const room = (name?: string) => (name ? hotelRooms.find((x) => x.name === name)?.id ?? null : null);
  for (const k of ["hotel_before", "hotel_after"] as const) {
    const h = r[k];
    if (!h) continue;
    const other = k === "hotel_before" ? "hotel_after" : "hotel_before";
    if (h.nights === 0) {
      // the answer "before" / "after": move the nights the other side had
      if (p[other].nights > 0) {
        p[k] = { ...p[other] };
        p[other] = { nights: 0, room_id: null };
        u.push(`hotel night${p[k].nights === 1 ? "" : "s"} ${k === "hotel_before" ? "before" : "after"} the Outpost`);
      }
      continue;
    }
    p[k] = { nights: h.nights, room_id: room(h.room) ?? p[k].room_id ?? (hotelRooms.length === 1 ? hotelRooms[0].id : null) };
    u.push(`${plural(h.nights, "night")} near Bagdogra ${k === "hotel_before" ? "on arrival" : "before departure"}${h.room ? ` (${h.room})` : ""}`);
  }
  if (r.hotel_room) {
    const id = room(r.hotel_room);
    for (const k of ["hotel_before", "hotel_after"] as const) if (id && p[k].nights > 0 && !p[k].room_id) p[k] = { ...p[k], room_id: id };
    if (id) u.push(r.hotel_room);
  }
  // Delhi: the flight Delhi - Bagdogra, nights at a Delhi hotel (Master data); the hotel named, else
  // the only one, else asked
  const delhiPick = (name?: string) => delhiHotels.find((h) => h.name === name) ?? (delhiHotels.length === 1 ? delhiHotels[0] : null);
  for (const k of ["delhi_before", "delhi_after"] as const) {
    const d = r[k];
    if (!d) continue;
    const h = d.nights > 0 ? delhiPick(d.hotel) ?? delhiHotels.find((x) => x.id === p[k].hotel_id) ?? null : null;
    p[k] = { flight: true, nights: d.nights, hotel_id: h?.id ?? (d.nights > 0 ? p[k].hotel_id : null), room_id: h ? (h.rooms.find((x) => x.id === p[k].room_id)?.id ?? h.rooms[0]?.id ?? null) : d.nights > 0 ? p[k].room_id : null };
    u.push(k === "delhi_before" ? (d.nights ? `${plural(d.nights, "night")} in Delhi first${h ? ` (${h.name})` : ""}, then the flight to Bagdogra` : "landing in Delhi, the same-day flight to Bagdogra") : d.nights ? `the flight back to Delhi, ${plural(d.nights, "night")} there${h ? ` (${h.name})` : ""}` : "the flight back to Delhi for the onward flight");
    if (k === "delhi_before") p.arrive_airport = "IXB";
    else p.depart_airport = "IXB";
  }
  if (r.delhi_hotel) {
    const h = delhiHotels.find((x) => x.name === r.delhi_hotel);
    for (const k of ["delhi_before", "delhi_after"] as const) if (h && p[k].nights > 0 && !p[k].hotel_id) p[k] = { ...p[k], hotel_id: h.id, room_id: h.rooms[0]?.id ?? null };
    if (h) u.push(h.name);
  }
  // hotel nights only through Bagdogra
  if (p.hotel_before.nights > 0 && !r.arrive_airport && p.arrive_airport !== "IXB") p.arrive_airport = "IXB";
  if (p.hotel_after.nights > 0 && !r.depart_airport && p.depart_airport !== "IXB") p.depart_airport = "IXB";

  const { question, pending } = nextQuestion(p, r, s, hotelRooms, delhiHotels);
  return { plan: p, understood: u, question, pending, ready: !pending };
}

// The first thing still needed for a price, as a question.
export function nextQuestion(p: RpPlan, r: RpReading, s: RpSettings, hotelRooms: { id: string; name: string }[] = [], delhiHotels: DelhiHotelOpt[] = []): { question: string | null; pending: RpPending } {
  if (!p.arrival && !p.dateless) return { question: "On which date do they arrive (the day they land)? If the dates are not fixed yet, say \"dates not fixed\".", pending: "arrival" };
  if (!(p.guest.adults >= 1)) return { question: "How many adults?", pending: "adults" };
  if (r.children && !p.guest.child_ages.length) return { question: `How old ${r.children === 1 ? "is the child" : "are the children"}? (Red Panda Outpost takes guests from ${s.min_age} years.)`, pending: "ages" };
  if (!p.guest.country && p.guest.booked_by === "direct") return { question: "Are the guests Indian or foreign? (The tariff differs.)", pending: "nationality" };
  const noRoom = (["hotel_before", "hotel_after"] as const).find((k) => p[k].nights > 0 && !p[k].room_id);
  if (noRoom && hotelRooms.length > 1) return { question: `Which room at the hotel near Bagdogra: ${hotelRooms.map((x) => x.name).join(" or ")}?`, pending: "hotel_room" };
  const noDelhiHotel = (["delhi_before", "delhi_after"] as const).find((k) => p[k].nights > 0 && !p[k].hotel_id);
  if (noDelhiHotel && delhiHotels.length > 1) return { question: `Which hotel in Delhi: ${delhiHotels.map((x) => x.name).join(" or ")}?`, pending: "delhi_hotel" };
  return { question: null, pending: null };
}

// The reply in the chat.
export function replyText(a: AssistReply, sourceNote: string): string {
  const parts: string[] = [];
  if (a.understood.length) parts.push(`Understood: ${a.understood.join("; ")}.`);
  else parts.push("I could not read anything new from that.");
  if (a.question) parts.push(a.question);
  else parts.push("That is everything for a price. Check the trip on Confirm, or tell me what to change.");
  if (sourceNote) parts.push(sourceNote);
  return parts.join("\n");
}

// ---------------- Confirm ----------------

// The trip in plain words, in the order it happens.
export function tripSummary(p: RpPlan, s: RpSettings, hotelName: string | null, delhiHotels: { id: string; name: string }[] = []): { key: string; text: string }[] {
  const delhiName = (id: string | null) => delhiHotels.find((h) => h.id === id)?.name ?? null;
  const air = (c: string) => s.airports.find((a) => a.code === c)?.name ?? c;
  const lines: { key: string; text: string }[] = [];
  const kids = p.guest.child_ages.length ? ` and ${plural(p.guest.child_ages.length, "child")} (aged ${p.guest.child_ages.join(", ")})` : "";
  lines.push({ key: "guests", text: `${plural(p.guest.adults, "adult")}${kids}${p.tour_leader ? ", with a tour leader" : ""}; ${p.guest.nationality === "indian" ? "Indian" : `foreign${p.guest.country ? ` (${p.guest.country})` : ""}`}; ${p.guest.booked_by === "agent" ? `through an agent${p.guest.agent_name ? ` (${p.guest.agent_name})` : ""}` : "direct guest"}.` });
  const dIn = p.delhi_before;
  if (dIn.flight) {
    lines.push({ key: "delhi_before", text: `${p.dateless ? "Dates not fixed yet" : fmtD(p.arrival)}: land in Delhi${dIn.nights ? `; ${plural(dIn.nights, "night")} in Delhi${delhiName(dIn.hotel_id) ? ` at ${delhiName(dIn.hotel_id)}` : ""}` : ", same-day connection"}.` });
    lines.push({ key: "arrive", text: `Fly Delhi to ${air(p.arrive_airport)}.` });
  } else lines.push({ key: "arrive", text: `${p.dateless ? "Dates not fixed yet" : fmtD(p.arrival)}: land at ${air(p.arrive_airport)}.` });
  const hb = p.hotel_before.nights;
  if (hb > 0) lines.push({ key: "hotel_before", text: `${plural(hb, "night")} at ${hotelName ?? "the hotel near Bagdogra"}.` });
  lines.push({ key: "outpost", text: `${plural(p.nights, "night")} at Red Panda Outpost${p.guest.rooms ? `, ${plural(p.guest.rooms, "room")}` : ""}.` });
  const ha = p.hotel_after.nights;
  if (ha > 0) lines.push({ key: "hotel_after", text: `${plural(ha, "night")} at ${hotelName ?? "the hotel near Bagdogra"}.` });
  const dOut = p.delhi_after;
  if (dOut.flight) {
    lines.push({ key: "depart", text: `Fly ${air(p.depart_airport)} to Delhi.` });
    lines.push({ key: "delhi_after", text: dOut.nights ? `${plural(dOut.nights, "night")} in Delhi${delhiName(dOut.hotel_id) ? ` at ${delhiName(dOut.hotel_id)}` : ""}, then the flight home.` : "Onward flight from Delhi the same day." });
  } else lines.push({ key: "depart", text: `Fly out from ${air(p.depart_airport)}.` });
  return lines;
}

// What makes the trip: the Confirm step's "Correct, continue" stores this; Plan & price and saving
// for the guest need it to match (any change to the trip means confirming again).
export function rpConfirmKey(p: RpPlan): string {
  return JSON.stringify([
    p.guest.adults, p.guest.child_ages, p.guest.rooms ?? null, p.guest.nationality, p.guest.booked_by, p.arrival, p.nights,
    p.arrive_airport, p.depart_airport, p.tour_leader, p.hotel_before.nights, p.hotel_before.room_id, p.hotel_after.nights, p.hotel_after.room_id,
    ...(p.delhi_before?.flight || p.delhi_after?.flight ? [p.delhi_before, p.delhi_after] : []),
    ...(p.dateless ? ["dateless", p.rate_season ?? null] : []), // (absent before: older confirmations stay)
  ]);
}
export const isRpConfirmed = (p: RpPlan) => !!p.confirmed && p.confirmed === rpConfirmKey(p);

// ---------------- other places too (Delhi, Kaziranga, our lodges) ----------------

// Places a Red Panda quote does not cover (Delhi it does): Kaziranga, our tiger lodges, other cities.
export const OTHER_PLACES = /\b(agra|jaipur|kaziranga|iora|guwahati|jorhat|assam|tadoba|waghoba|kanha|pench|bandhavgarh|satpura|denwa|panna|ken river|khajuraho|nagpur|jabalpur|bhopal|tiger|kings lodge|tree house)\b/i;
export const mentionsOtherPlaces = (text: string) => OTHER_PLACES.test(text);
