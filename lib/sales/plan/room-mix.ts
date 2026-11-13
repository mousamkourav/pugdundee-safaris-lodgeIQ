// More than one room type at one lodge (13 Nov 2026, G. Manager: "1 Cottage & 1 Tree House for
// Pench"). A stop's room_mix lists each room type with its rooms and the guests in them; the
// pricing takes each at its own Master data rate (single / double / extra adult / child on the
// guests in those rooms), and the offers count the lodge's nights once.
import type { BuilderContext, PlanGuest, PlanStop, RoomMixEntry } from "./types";

// the room types of a stop with their rooms and guests: the mix, or the one room type for everyone
export function roomsAt(stop: PlanStop, guest: Pick<PlanGuest, "adults" | "children" | "rooms">): RoomMixEntry[] {
  if (stop.room_mix && stop.room_mix.length >= 2) return stop.room_mix;
  return [{ room_category_id: stop.room_category_id, rooms: guest.rooms, adults: guest.adults, children: [...guest.children] }];
}

export const hasMix = (stop: PlanStop) => !!stop.room_mix && stop.room_mix.length >= 2;

// "1 AC Cottage + 1 AC Treehouse", or the one room's name
export function roomLabel(stop: PlanStop, ctx: Pick<BuilderContext, "rooms">): string {
  const name = (id: string) => ctx.rooms.find((r) => r.id === id)?.name ?? "Room";
  if (!hasMix(stop)) return stop.room_category_id ? name(stop.room_category_id) : "";
  return stop.room_mix!.map((m) => `${m.rooms} ${name(m.room_category_id)}`).join(" + ");
}

// Adults spread over the rooms two to a room (the first rooms first), the children with the first
// room type: a starting point the sales person changes.
export function splitGuests(entries: { room_category_id: string; rooms: number }[], guest: Pick<PlanGuest, "adults" | "children">): RoomMixEntry[] {
  const total = entries.reduce((t, e) => t + e.rooms, 0);
  const perRoom = Array.from({ length: total }, (_, i) => Math.floor(guest.adults / total) + (i < guest.adults % total ? 1 : 0));
  let at = 0;
  return entries.map((e, k) => {
    const adults = perRoom.slice(at, at + e.rooms).reduce((t, n) => t + n, 0);
    at += e.rooms;
    return { room_category_id: e.room_category_id, rooms: e.rooms, adults, children: k === 0 ? [...guest.children] : [] };
  });
}

// "Add another room type": the current room for all but one room, the other room type for one
export function addRoomType(stop: PlanStop, guest: Pick<PlanGuest, "adults" | "children" | "rooms">, roomId: string): PlanStop {
  const cur = roomsAt(stop, guest);
  if (cur.length === 1) {
    const main = Math.max(1, cur[0].rooms - 1);
    return { ...stop, room_mix: splitGuests([{ room_category_id: cur[0].room_category_id, rooms: main }, { room_category_id: roomId, rooms: 1 }], guest) };
  }
  return { ...stop, room_mix: splitGuests([...cur.map((e) => ({ room_category_id: e.room_category_id, rooms: e.rooms })), { room_category_id: roomId, rooms: 1 }], guest) };
}

// Change one room type's line; a mix left with one entry is a single room type again
export function setMixEntry(stop: PlanStop, i: number, patch: Partial<RoomMixEntry> | "remove"): PlanStop {
  if (!stop.room_mix) return stop;
  const mix = patch === "remove" ? stop.room_mix.filter((_, k) => k !== i) : stop.room_mix.map((e, k) => (k === i ? { ...e, ...patch } : e));
  if (mix.length < 2) {
    const { room_mix: _m, ...rest } = stop;
    return { ...rest, room_category_id: mix[0]?.room_category_id ?? stop.room_category_id };
  }
  return { ...stop, room_mix: mix, room_category_id: mix[0].room_category_id };
}

// What must be right before the quote is priced: the room types hold exactly the trip's guests
export function mixProblems(stop: PlanStop, guest: Pick<PlanGuest, "adults" | "children">, ctx: BuilderContext, lodgeName: string): string[] {
  if (!hasMix(stop)) return [];
  const out: string[] = [];
  const mix = stop.room_mix!;
  const roomsHere = ctx.rooms.filter((r) => r.property_id === stop.property_id).map((r) => r.id);
  if (mix.some((m) => !roomsHere.includes(m.room_category_id))) out.push(`${lodgeName}: a room type is not one of this lodge's rooms. Choose the rooms again.`);
  const adults = mix.reduce((t, m) => t + m.adults, 0);
  const kids = mix.flatMap((m) => m.children).sort((a, b) => a - b);
  const want = [...guest.children].sort((a, b) => a - b);
  if (adults !== guest.adults || kids.join(",") !== want.join(",")) {
    const say = (a: number, c: number) => `${a} adult${a === 1 ? "" : "s"}${c ? ` and ${c} child${c === 1 ? "" : "ren"}` : ""}`;
    out.push(`${lodgeName}: the room types hold ${say(adults, kids.length)}, the trip has ${say(guest.adults, want.length)}. Change the guests in the room types.`);
  }
  if (mix.some((m) => m.adults < 1)) out.push(`${lodgeName}: every room type needs at least one adult.`);
  return out;
}
