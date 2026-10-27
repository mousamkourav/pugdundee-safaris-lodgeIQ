// =====================================================================
// The trip assistant: a conversation that builds the plan step by step.
// Each message is read by the built-in reader (and optionally the AI
// fallback), MERGED into the current plan (not replacing it), and the
// assistant replies with what it understood and the next thing it needs.
// Pure function, so it is easy to test and runs instantly in the browser.
// =====================================================================

import { rupees } from "@/lib/sales/format";
import { paxText } from "@/lib/sales/pricing/pax";
import { countryName, findPhone } from "@/lib/sales/countries";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { ISODate } from "@/lib/sales/pricing/types";
import { mergePrimary } from "./ai";
import { ROOM_MATCH, aliasesOf, extractTrip, lodgeNamedIn, locationAliases, matchByName, mergeParsed, roomWishIn, type Ask, type ParsedTrip, type RoomWish } from "./parse-text";
import { buildDays, defaultStop, defaultVehicle, emptyPlan, lodgesInPark, mealPlansOf, planToTrip, roomsOf, routeKey, routeProblems } from "./planner";
import type { BuilderContext, Plan, PlanStop } from "./types";
import { cityHotelNamed, cityHotels, safariOnly, sameCity } from "./cities";
import { tripChecklist, type CheckItem } from "./checklist";

export interface ChatFlags {
  dateSet: boolean;
  adultsSet: boolean;
  roomsSet: boolean;
  arrivalAsked: boolean;
  departureAsked?: boolean;
  nightsUnknown: string[]; // park ids added without a number of nights
  roomDecided?: string[]; // park ids where Cottage / Tree House is settled
  lodgeDecided?: string[]; // park ids where the lodge is settled (Bandhavgarh: Kings Lodge or Tree House Hideaway)
  roomFor?: string | null; // the park the last Cottage / Tree House question was about
  hotelAsked?: string[]; // city stays ("before:Delhi") whose hotel has been asked
  hotelFor?: string | null;
  nationalitySet?: boolean; // Indian / foreign (or the country) was said
  legAsked?: boolean; // "our car or own vehicle between the lodges?" has been answered
  asks?: Ask[]; // what the reader found unclear, asked one by one before the price
  askFor?: string | null; // the ask the last question was
  pending: "parks" | "nights" | "date" | "adults" | "arrival" | "departure" | "lodge" | "room" | "hotel" | "name" | "leg" | "ask" | null;
}

export interface QuickReply {
  label: string;
  text?: string; // sent as if typed
  action?: "review"; // or a builder action
}

export interface ChatMessage {
  role: "assistant" | "user";
  text: string;
  chips?: string[]; // what was understood (green)
  warnings?: string[]; // assumptions and problems (amber)
  quick?: QuickReply[];
  action?: "review";
  checklist?: CheckItem[]; // the whole trip: ticks and questions
}

export interface ChatResult {
  plan: Plan;
  flags: ChatFlags;
  reply: ChatMessage;
  understood: boolean;
  routeChanged: boolean;
}

const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDNUM[s] ?? NaN);
const shortName = (name: string) => aliasesOf(name).sort((a, b) => a.length - b.length)[0]?.replace(/^\w/, (c) => c.toUpperCase()) ?? name;

// The room type for a wish ("tree", "suite"...); for "cottage", any room that is not a tree house.
function pickRoom<T extends { name: string }>(rooms: T[], wish: RoomWish): T | undefined {
  return rooms.find((r) => ROOM_MATCH[wish].test(r.name)) ?? (wish === "cottage" ? rooms.find((r) => !/tree ?house|suite|deluxe room/i.test(r.name)) : undefined);
}

export function initialFlags(plan: Plan): ChatFlags {
  const editing = plan.stops.length > 0;
  return {
    dateSet: editing,
    adultsSet: editing,
    roomsSet: editing,
    arrivalAsked: editing,
    departureAsked: editing,
    nightsUnknown: [],
    roomDecided: editing ? plan.stops.map((s) => s.park_id) : [],
    lodgeDecided: editing ? plan.stops.map((s) => s.park_id) : [],
    roomFor: null,
    nationalitySet: editing,
    legAsked: editing,
    asks: [],
    pending: editing ? null : "parks",
  };
}

export function greeting(plan: Plan, queryNo?: string | null): ChatMessage {
  if (plan.stops.length) {
    return {
      role: "assistant",
      text: `${queryNo ? `Editing ${queryNo}. ` : ""}Tell me what to change, for example "make Pench 2 nights", "add Kanha 3 nights", "3 adults" or "arrive at Jabalpur". You can also edit the details on the right.`,
    };
  }
  return {
    role: "assistant",
    text: 'Describe the trip in your own words, for example "2 adults, arriving Nagpur 16 Jan 2027, Tadoba 4 nights then Pench 3 nights". I will ask for anything missing and work out the price.',
  };
}

const placesOf = (ctx: BuilderContext) => {
  const rank: Record<string, number> = { airport: 0, railway: 1, city: 2, other: 3 };
  return ctx.locations.filter((l) => l.type !== "property").sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));
};

// ---------------------------------------------------------------------------
export function chatTurn(
  plan: Plan,
  flags: ChatFlags,
  message: string,
  full: BuilderContext,
  today: ISODate,
  aiParsed?: ParsedTrip,
  opts: { aiPrimary?: boolean } = {}
): ChatResult {
  // Stops are planned from safari parks and lodges only; cities (Delhi, Khajuraho) and
  // city hotels (Roseate House) are city stays.
  const ctx = safariOnly(full);
  const msg = message.trim();
  const low = msg.toLowerCase();

  if (/^(start over|start again|reset|new trip|clear( all)?)\b/.test(low)) {
    const fresh = { ...emptyPlan(today), vehicle_type: defaultVehicle(ctx) };
    return {
      plan: fresh,
      flags: initialFlags(fresh),
      reply: { role: "assistant", text: "Starting fresh. " + greeting(fresh).text },
      understood: true,
      routeChanged: true,
    };
  }

  const next: Plan = JSON.parse(JSON.stringify(plan));
  const f: ChatFlags = {
    ...flags,
    nightsUnknown: [...flags.nightsUnknown],
    roomDecided: [...(flags.roomDecided ?? [])],
    lodgeDecided: [...(flags.lodgeDecided ?? [])],
    hotelAsked: [...(flags.hotelAsked ?? [])],
    asks: [...(flags.asks ?? [])],
  };
  const chips: string[] = [];
  const warnings: string[] = [];
  const parkName = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? "the park";

  // ---- guest contact details
  const email = msg.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) {
    next.guest.email = email[0];
    chips.push(`email ${email[0]}`);
  }
  const phone = findPhone(msg, next.guest.phone_country || next.guest.country || "IN");
  if (phone) {
    next.guest.phone = phone.phone;
    next.guest.phone_country = phone.country;
    chips.push(`phone ${phone.phone}`);
  }
  const nameM =
    msg.match(/\b(?:guest(?:'s)?\s+name|name)\s*(?:is|:|-)\s*([^,.;\n]{2,60})/i) ??
    msg.match(/\bfor\s+((?:mr|mrs|ms|miss|dr)\.?\s+[A-Za-z][^,.;\n]{1,50})/i) ??
    msg.match(/^((?:mr|mrs|ms|miss|dr)\.?\s+[A-Za-z][A-Za-z&' -]{1,40}?)\s*(?=[,;\n]|$)/i) ?? // "Mr Shah, 2 adults..."
    msg.match(/^((?:mr|mrs|ms|miss|dr)\.?\s+[A-Za-z][a-zA-Z'-]+)\s+(?:group|family|party|and family|ji)\b/i); // "Mrs Sharma group of 8"
  if (nameM) {
    // "Mr Shah from UK" -> name "Mr Shah" (the country goes to Nationality)
    next.guest.name = nameM[1].replace(/\s+(from|of|ex)\s+.*$/i, "").trim();
    chips.push(`guest ${next.guest.name}`);
  }

  // ---- "on their own": no pick-up or drop (their own vehicle is read with the trip, below)
  if (/\b(on (their|his|her) own|no (pick ?up|drop|transfers?|airport))\b/.test(low)) {
    if (f.pending === "departure" || /\b(leav\w*|depart\w*|drop)\b/.test(low)) {
      next.departure_location_id = null; // only the way out
      f.departureAsked = true;
      chips.push("they leave on their own (no drop)");
    } else {
      next.arrival_location_id = null;
      next.departure_location_id = null;
      f.arrivalAsked = true;
      f.departureAsked = true;
      chips.push("no airport or station transfers");
    }
  }

  // ---- removing parks: "remove Pench", "without Satpura", "instead of Pench"
  const removed = new Set<string>();
  for (const park of ctx.pricing.parks) {
    for (const a of aliasesOf(park.name)) {
      const name = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b(remove|drop|skip|without|delete|cancel|exclude|no|instead of|replace)\\s+(the\\s+)?${name}\\b`, "i");
      // Hindi, after the name: "pench hata do", "pench nikal do", "pench nahi"
      const hindi = new RegExp(`\\b${name}\\s+(?:ko\\s+)?(?:hata\\s*(?:do|de|dijiye)|hatao|nikal\\s*(?:do|de)|nikalo|remove(?:\\s+karo)?|cancel(?:\\s+karo)?|nahi(?:\\s+chahiye)?)\\b`, "i");
      if ((re.test(msg) || hindi.test(msg)) && next.stops.some((s) => s.park_id === park.id)) {
        next.stops = next.stops.filter((s) => s.park_id !== park.id);
        f.nightsUnknown = f.nightsUnknown.filter((x) => x !== park.id);
        removed.add(park.name);
        chips.push(`removed ${park.name}`);
        break;
      }
    }
  }

  // ---- read the message
  let parsed = extractTrip(msg, ctx, today, cityHotels(full));
  // With the AI assistant on, its reading comes first and the built-in reader fills gaps;
  // otherwise the AI only fills what the built-in reader missed.
  const ruleParsed = parsed;
  if (aiParsed) parsed = opts.aiPrimary ? mergePrimary(aiParsed, parsed) : mergeParsed(parsed, aiParsed);
  // A lodge counts only when the message names it. The AI sometimes picks one by itself
  // (Kings Lodge for "Bandhavgarh 3 nights"); then the guest is asked which lodge instead.
  if (aiParsed) {
    parsed = {
      ...parsed,
      parks: parsed.parks.map((p) =>
        p.lodge && !ruleParsed.parks.some((r) => r.lodge === p.lodge) && !lodgeNamedIn(msg, p.lodge, ctx) ? { ...p, lodge: undefined } : p
      ),
    };
  }

  // ---- from the AI: a whole new route, parks to take out
  if (parsed.replaceRoute && parsed.parks.length && next.stops.length) {
    next.stops = [];
    f.nightsUnknown = [];
    chips.push("new route");
  }
  for (const name of parsed.removeParks ?? []) {
    const park = ctx.pricing.parks.find((p) => p.name === name);
    if (park && next.stops.some((s) => s.park_id === park.id)) {
      next.stops = next.stops.filter((s) => s.park_id !== park.id);
      removed.add(park.name);
      chips.push(`removed ${park.name}`);
    }
  }
  parsed.parks = parsed.parks.filter((p) => !removed.has(p.name));
  warnings.push(...parsed.notes.filter((n) => !n.startsWith("Assumed the guest also leaves")));

  // ---- a reply to "our car or their own vehicle between the lodges?" / "how do they leave?"
  if (f.pending === "leg" && !parsed.parks.length) {
    const own = /\b(own|apni|apna|khud|self|themselves|their)\b/.test(low);
    const ours = !own && /\b(our|ours|we|us|car|transfer|arrange|yes)\b/.test(low);
    if (own || ours) {
      next.between_lodges = own ? "own" : "ours";
      f.legAsked = true;
      chips.push(own ? "between the lodges: their own vehicle" : "between the lodges: our car");
      parsed = { ...parsed, own_all: false, between: undefined, arrival_mode: undefined, departure_mode: undefined };
    }
  }
  if (f.pending === "departure" && parsed.own_all && !parsed.parks.length) {
    parsed = { ...parsed, own_all: false, between: undefined, arrival_mode: undefined, departure_mode: "own" };
  }

  // ---- how they travel (their own vehicle, train, flight, our car)
  if (parsed.own_all) {
    if (!next.own_vehicle) chips.push("own vehicle all the way: no transfers");
    next.own_vehicle = true;
    next.arrival_mode = next.departure_mode = "own";
    next.arrival_location_id = next.departure_location_id = null;
    f.arrivalAsked = f.departureAsked = f.legAsked = true;
  } else {
    if (parsed.arrival_mode === "own") {
      next.arrival_mode = "own";
      next.arrival_location_id = null;
      f.arrivalAsked = true;
      chips.push("arriving in their own vehicle (no transfer)");
    } else if (parsed.arrival_mode) next.arrival_mode = parsed.arrival_mode;
    if (parsed.departure_mode === "own") {
      next.departure_mode = "own";
      next.departure_location_id = null;
      f.departureAsked = true;
      chips.push("leaving in their own vehicle (no transfer)");
    } else if (parsed.departure_mode) next.departure_mode = parsed.departure_mode;
    if (parsed.between) {
      next.between_lodges = parsed.between;
      f.legAsked = true;
      chips.push(parsed.between === "own" ? "between the lodges: their own vehicle" : "between the lodges: our car");
    }
  }

  // ---- special requests
  if (parsed.requests?.length) {
    const fresh = parsed.requests.filter((r) => !(next.requests ?? []).includes(r));
    next.requests = [...(next.requests ?? []), ...fresh];
    if (fresh.length) chips.push(`special request${fresh.length === 1 ? "" : "s"}: ${fresh.join(", ")}`);
  }

  // ---- parks that are not ours: say so, never make up a lodge
  for (const n of parsed.notOurs ?? []) {
    const ours = ctx.pricing.parks.filter((p) => lodgesInPark(ctx, p.id).length).map((p) => shortName(p.name));
    warnings.push(`${n} is not one of our parks, so it cannot be quoted here. Our parks: ${ours.join(", ")}.`);
  }

  // ---- the answer to the reader's own question (fishing, flight time, ages...)
  const answering = f.pending === "ask" ? f.asks?.find((a) => a.key === f.askFor) : undefined;
  if (answering) {
    f.asks = (f.asks ?? []).filter((a) => a !== answering);
    const before = chips.length;
    if (answering.key.startsWith("fishing:")) {
      const len = /\bfull\b/.test(low) ? "full" : /\bhalf\b/.test(low) ? "half" : null;
      const park = ctx.pricing.parks.find((p) => p.name === answering.key.slice(8));
      if (len && park) {
        next.stops = next.stops.map((s) => (s.park_id === park.id ? { ...s, want_extras: (s.want_extras ?? []).map((x) => (x === "fishing" ? `${len} day fishing` : x)) } : s));
        chips.push(`${len}-day fishing`);
      }
    } else if (answering.key === "flight-time" && next.flights?.length === 1) {
      const fl = next.flights[0];
      if (/\b(depart\w*|home|return\w*|out\w*|back|last|leav\w*|going)\b/.test(low) && fl.time) {
        next.flights = [{ from: fl.from, to: fl.to }, { from: fl.to, to: fl.from, time: fl.time }];
        chips.push(`flight ${fl.to} to ${fl.from} at ${fl.time}`);
      } else if (/\b(arriv\w*|in|first|incoming|coming)\b/.test(low)) chips.push(`flight ${fl.from} to ${fl.to} at ${fl.time}`);
    } else if (answering.key === "ages" && next.guest.children.length) {
      const ages = (msg.match(/\d{1,2}/g) ?? []).map(Number).filter((n) => n < 18);
      if (ages.length === next.guest.children.length) {
        next.guest.children = ages;
        chips.push(`children aged ${ages.join(", ")}`);
      }
    }
    // anything else is kept word for word with the trip, so nothing said is lost
    if (chips.length === before && !parsed.adults && !parsed.parks.length && !parsed.arrival_date) {
      next.guest.notes = [next.guest.notes.trim(), `${answering.text} Answer: ${msg}`].filter(Boolean).join("\n").slice(0, 2000);
      chips.push("noted with the trip");
    }
  }
  for (const a of parsed.asks ?? []) if (!(f.asks ?? []).some((x) => x.key === a.key)) f.asks = [...(f.asks ?? []), a];

  // A bare answer to the last question: "4", "3 nights", "2 adults"
  const bare = low.match(/^\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(nights?|n|adults?|pax|people|guests)?\s*\.?$/);
  if (bare) {
    const n = num(bare[1]);
    if (f.pending === "nights" && f.nightsUnknown.length && n > 0) {
      const pid = f.nightsUnknown.shift()!;
      next.stops = next.stops.map((s) => (s.park_id === pid ? { ...s, nights: n } : s));
      chips.push(`${parkName(pid)} ${n} night${n === 1 ? "" : "s"}`);
    } else if ((f.pending === "adults" || /adult|pax|people|guest/.test(bare[2] ?? "")) && n > 0) {
      parsed.adults = n;
    }
  }

  // ---- guests
  if (parsed.adults) {
    next.guest.adults = Math.min(50, parsed.adults);
    f.adultsSet = true;
    chips.push(`${next.guest.adults} adult${next.guest.adults === 1 ? "" : "s"}`);
  }
  if (parsed.children?.length) {
    next.guest.children = parsed.children;
    chips.push(`children aged ${parsed.children.join(", ")}`);
  } else if (/\bno (kids|children)\b/.test(low)) {
    next.guest.children = [];
    chips.push("no children");
  }
  if (parsed.rooms) {
    next.guest.rooms = parsed.rooms;
    f.roomsSet = true;
    chips.push(`${parsed.rooms} room${parsed.rooms === 1 ? "" : "s"}`);
  } else if (parsed.adults && !f.roomsSet) {
    next.guest.rooms = Math.max(1, Math.ceil(next.guest.adults / 2));
    chips.push(`${next.guest.rooms} room${next.guest.rooms === 1 ? "" : "s"} (2 per room; say "3 rooms" to change)`);
  }
  if (parsed.country) {
    next.guest.country = parsed.country;
    next.guest.nationality = parsed.country === "IN" ? "indian" : "foreign";
    if (!next.guest.phone) next.guest.phone_country = parsed.country;
    f.nationalitySet = true;
    chips.push(`guests from ${countryName(parsed.country)}`);
  } else if (parsed.nationality) {
    next.guest.nationality = parsed.nationality;
    f.nationalitySet = true;
    chips.push(parsed.nationality === "indian" ? "Indian guests" : "foreign guests");
  }

  // ---- dates
  if (parsed.arrival_date) {
    if (parsed.arrival_date < today) warnings.push(`${parsed.arrival_date} is in the past. Please check the date.`);
    next.arrival_date = parsed.arrival_date;
    f.dateSet = true;
    chips.push(`arriving ${parsed.arrival_date}`);
  } else if (/\bdates?\s+not\s+fixed\b|\bno\s+fixed\s+dates?\b|\bdateless\b/.test(low) && !f.dateSet) {
    next.dateless = true;
    f.dateSet = true;
    chips.push("dates not fixed: priced by season");
  } else if (f.pending === "date" && !chips.length && !parsed.parks.length) {
    warnings.push('I could not read a date there. Try "16 Jan 2027" or "16/01/2027".');
  }

  // ---- arrival and departure points
  const places = placesOf(ctx);
  const arr = matchByName(places, parsed.arrival_place, locationAliases);
  const dep = matchByName(places, parsed.departure_place, locationAliases);
  const assumedSame = parsed.notes.some((n) => n.startsWith("Assumed the guest also leaves"));
  // A single place in reply to "where do they leave from?" is the way out, not a new arrival.
  const answersDeparture = f.pending === "departure" && !!arr && (!dep || assumedSame) && !!plan.arrival_location_id;
  if (arr && !answersDeparture) {
    next.arrival_location_id = arr.id;
    if (next.arrival_mode === "own") delete next.arrival_mode;
    f.arrivalAsked = true;
    chips.push(`arriving via ${arr.name}${parsed.arrival_mode === "train" ? " (train)" : ""}`);
  }
  if (dep && (!assumedSame || parsed.same_out) && !answersDeparture) {
    next.departure_location_id = dep.id;
    if (next.departure_mode === "own") delete next.departure_mode;
    f.departureAsked = true;
    chips.push(`leaving via ${dep.name}${parsed.departure_mode === "train" ? " (train)" : parsed.departure_mode === "flight" ? " (flight)" : ""}`);
  } else if (f.pending === "departure" && /^(same|yes|yep|same airport|same place|same as arrival)\b/i.test(low) && next.arrival_location_id) {
    next.departure_location_id = next.arrival_location_id;
    f.departureAsked = true;
    chips.push(`leaving via ${ctx.locations.find((l) => l.id === next.arrival_location_id)?.name}`);
  } else if (answersDeparture && arr) {
    // answering "where do they leave from?" with one place
    next.departure_location_id = arr.id;
    next.arrival_location_id = plan.arrival_location_id;
    f.departureAsked = true;
    chips.push(`leaving via ${arr.name}`);
  }
  if (f.pending === "arrival" && !arr && dep && !next.arrival_location_id) {
    next.arrival_location_id = dep.id;
    f.arrivalAsked = true;
    chips.push(`arriving via ${dep.name}`);
  }
  if (parsed.arrival_place && !arr) warnings.push(`"${parsed.arrival_place}" is not in the airports and stations list (Master data).`);

  // ---- parks: update the ones already in the trip, add new ones
  for (const p of parsed.parks) {
    const park = matchByName(ctx.pricing.parks, p.name, aliasesOf);
    if (!park) {
      warnings.push(`I do not know the park "${p.name}".`);
      continue;
    }
    const lodgeObj = p.lodge ? lodgesInPark(ctx, park.id).find((l) => l.name.toLowerCase() === p.lodge!.toLowerCase()) : undefined;
    const twoInPark = parsed.parks.filter((x) => x.name === p.name).length > 1;
    let idx = lodgeObj ? next.stops.findIndex((s) => s.property_id === lodgeObj.id) : -1;
    if (idx < 0 && !twoInPark) idx = next.stops.findIndex((s) => s.park_id === park.id);
    if (idx < 0 && !lodgesInPark(ctx, park.id).length) {
      warnings.push(`No lodge is set up in ${park.name} yet, so it cannot be added. Add one in Master data.`);
      continue;
    }
    let i = idx;
    if (idx < 0) {
      next.stops.push(defaultStop(ctx, park.id, p.nights ?? 2));
      i = next.stops.length - 1;
      if (!p.nights) f.nightsUnknown.push(park.id);
    } else if (p.nights) {
      next.stops[idx] = { ...next.stops[idx], nights: p.nights };
      f.nightsUnknown = f.nightsUnknown.filter((x) => x !== park.id);
    }
    if (p.lodge) {
      const lodge = lodgesInPark(ctx, park.id).find((l) => l.name.toLowerCase() === p.lodge!.toLowerCase());
      if (lodge && lodge.id !== next.stops[i].property_id) {
        const room = roomsOf(ctx, lodge.id)[0];
        next.stops[i] = { ...next.stops[i], property_id: lodge.id, room_category_id: room?.id ?? "", meal_plan: room ? mealPlansOf(ctx, room.id)[0] ?? "AP" : "AP" };
      }
    }
    if (p.lodge) f.lodgeDecided = [...new Set([...(f.lodgeDecided ?? []), park.id])];
    // what the guest asked for here: safaris, naturalists, experiences, room type
    const wish: Partial<PlanStop> = {};
    if (p.safaris != null) wish.want_safaris = p.safaris;
    if (p.naturalists != null) wish.want_naturalists = p.naturalists;
    if (p.extras?.length) wish.want_extras = [...new Set([...(next.stops[i].want_extras ?? []), ...p.extras])];
    if (p.sessions) wish.want_sessions = p.sessions;
    if (p.jeeps) wish.want_jeeps = p.jeeps;
    if (p.qty) wish.want_qty = { ...(next.stops[i].want_qty ?? {}), ...p.qty };
    if (p.room || p.roomName) {
      // a room named by its own word first ("stilted"), else the kind of room ("cottage")
      const rooms = roomsOf(ctx, next.stops[i].property_id);
      const want = rooms.find((r) => r.name === p.roomName) ?? (p.room ? pickRoom(rooms, p.room) : undefined);
      if (want) {
        const meals = mealPlansOf(ctx, want.id);
        wish.room_category_id = want.id;
        wish.meal_plan = meals.includes(next.stops[i].meal_plan) ? next.stops[i].meal_plan : meals[0] ?? next.stops[i].meal_plan;
      }
      f.roomDecided = [...new Set([...(f.roomDecided ?? []), park.id])];
    }
    next.stops[i] = { ...next.stops[i], ...wish };
    const stop = next.stops[i];
    // a lodge already in the trip, only named (e.g. "Kanha first"): nothing new to report    if (idx >= 0 && !p.nights && !p.lodge && !Object.keys(wish).length) continue;
    const lodgeName = ctx.properties.find((x) => x.id === stop.property_id)?.name;
    const roomName = p.room || p.roomName ? ctx.rooms.find((r) => r.id === stop.room_category_id)?.name : null;
    chips.push(
      `${park.name} ${p.nights ? `${stop.nights} night${stop.nights === 1 ? "" : "s"}${p.nightsFromDays ? ` (from "${p.nights} days")` : ""}` : "(nights to confirm)"}${lodgeName ? ` at ${lodgeName}` : ""}${roomName ? `, ${roomName}` : ""}`
    );
    if (p.safaris != null || p.naturalists != null || p.sessions || p.jeeps) {
      const n = p.safaris;
      const nat = p.naturalists === -1 ? "all with a naturalist" : p.naturalists ? `${p.naturalists} with a naturalist` : p.naturalists === 0 ? "no naturalist" : "";
      const more = [p.sessions ? `${p.sessions === "morning" ? "mornings" : "evenings"} only` : "", p.jeeps ? `${p.jeeps} jeeps each` : ""].filter(Boolean).join(", ");
      chips.push(`${n != null ? `${n} safari${n === 1 ? "" : "s"}` : "safaris"}${nat ? `, ${nat}` : ""}${more ? `, ${more}` : ""} in ${park.name.split(/[ -]/)[0]}`);
    }
    for (const x of p.extras ?? []) chips.push(`${x === "special" ? "the lodge's own experiences" : `${x}${p.qty?.[x] ? ` x${p.qty[x]}` : ""}`} at ${lodgeName ?? park.name}`);
  }

  // ---- with flights, the airports are where they fly in and out: "fly to Bhopal ... leave from Nagpur to Delhi"
  if (parsed.flights?.length) {
    // the airport of a city: one called "... Airport" first when there are two ("Delhi", "Delhi Airport (IGI)")
    const airportFor = (city: string) => {
      const all = placesOf(ctx).filter((l) => l.type === "airport" && (l.name.toLowerCase().startsWith(city.toLowerCase()) || sameCity(l.name, city)));
      return all.find((l) => /airport/i.test(l.name)) ?? all[0];
    };
    const fl = parsed.flights;
    const stays = parsed.cityStays ?? [];
    const beforeCity = stays.find((c) => c.when === "before")?.city;
    const afterCity = stays.find((c) => c.when === "after")?.city;
    const isAfterCity = (c: string) => stays.some((s) => s.when === "after" && sameCity(s.city, c));
    // flying in: from the city they stay in first, else the first flight that does not leave an end-of-trip city
    const inbound = (beforeCity ? fl.find((x) => sameCity(x.from, beforeCity)) : undefined) ?? fl.find((x) => !isAfterCity(x.from) && (fl.length > 1 || !afterCity));
    const outbound =
      [...fl].reverse().find((x) => afterCity && sameCity(x.to, afterCity) && x !== inbound) ??
      fl.find((x) => afterCity && sameCity(x.from, afterCity) && x !== inbound) ??
      (fl.length > 1 ? fl[fl.length - 1] : undefined);
    const inAirport = inbound && airportFor(inbound.to);
    const outAirport = outbound && airportFor(outbound.from);
    if (inAirport && next.arrival_location_id !== inAirport.id) {
      next.arrival_location_id = inAirport.id;
      f.arrivalAsked = true;
      chips.push(`arriving via ${inAirport.name} (flight from ${inbound!.from})`);
    }
    if (inAirport) next.arrival_mode = "flight";
    if (outAirport && next.departure_location_id !== outAirport.id) {
      next.departure_location_id = outAirport.id;
      f.departureAsked = true;
      chips.push(`leaving via ${outAirport.name} (flight to ${outbound!.to})`);
    }
    if (outAirport) next.departure_mode = "flight";
  }

  // ---- the hotel for a city stay (answer to "Which hotel in Delhi?")
  if (f.pending === "hotel" && f.hotelFor && !parsed.parks.length) {
    const stay = (next.city_stays ?? []).find((c) => `${c.when}:${c.city}` === f.hotelFor);
    if (stay) {
      const tbc = /\b(tbc|to be confirmed|later|not sure|skip|no idea|none|own|their own)\b/.test(low);
      // "same" / "same hotel": copy the other stay in this city
      const same = /^(same|same hotel|same as before|same one|same as the other)\b/.test(low) ? (next.city_stays ?? []).find((c) => c !== stay && c.city === stay.city && c.hotel) : undefined;
      if (same) {
        next.city_stays = (next.city_stays ?? []).map((c) => (c === stay ? { ...c, hotel: same.hotel, ...(same.price ? { price: same.price } : {}) } : c));
        f.hotelAsked = [...new Set([...(f.hotelAsked ?? []), f.hotelFor])];
        chips.push(`${stay.city}: ${same.hotel}${same.price ? `, ${rupees(same.price)} a night` : ""}`);
      }
      const priceM = msg.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac)?\b/i);
      let price: number | null = null;
      if (priceM) price = Math.round(Number(priceM[1]) * (/^k|thousand/i.test(priceM[2] ?? "") ? 1000 : /lakh|lac/i.test(priceM[2] ?? "") ? 100000 : 1));
      // a hotel from Master data (Roseate House): its name as saved there
      const known = tbc ? undefined : cityHotelNamed(msg, full, stay.city);
      const typed = tbc ? "" : msg.replace(/(?:rs\.?|inr|\u20b9)?\s*[\d,]+(?:\.\d+)?\s*(?:k|thousand|lakh|lac)?\b.*$/i, "").replace(/\b(per night|a night|night|hotel is|hotel)\b/gi, "").replace(/[,;:-]+\s*$/, "").trim();
      const name = known?.name ?? typed;
      if (!same) {
        next.city_stays = (next.city_stays ?? []).map((c) => (c === stay ? { ...c, ...(name ? { hotel: name } : {}), ...(price && price >= 500 ? { price } : {}) } : c));
        f.hotelAsked = [...new Set([...(f.hotelAsked ?? []), f.hotelFor])];
        chips.push(tbc ? `${stay.city} hotel to be confirmed` : `${stay.city}: ${name || "hotel"}${price && price >= 500 ? `, ${rupees(price)} a night` : ""}`);
      }
    }
  }

  // ---- "no Delhi stay", "remove the flights"
  for (const c of next.city_stays ?? []) {
    if (new RegExp(`\\b(remove|no|without|skip|drop|cancel|delete)\\s+(the\\s+)?(${c.city.toLowerCase()}|city)\\b`).test(low)) {
      next.city_stays = (next.city_stays ?? []).filter((x) => x !== c);
      chips.push(`removed the ${c.city} night${c.nights === 1 ? "" : "s"} ${c.when === "before" ? "before" : "at the end"}`);
    }
  }
  if (/\b(remove|no|without|skip|drop|cancel|delete)\s+(the\s+|all\s+)?flights?\b/.test(low) && next.flights?.length) {
    next.flights = [];
    chips.push("removed the flights");
  }

  // ---- flights and nights in a city (Delhi) before or after
  if (parsed.flights?.length) {
    next.flights = parsed.flights;
    for (const fl of parsed.flights) chips.push(`flight ${fl.from} to ${fl.to}${fl.time ? ` at ${fl.time}` : ""}`);
  }
  if (parsed.cityStays?.length) {
    const keep = (next.city_stays ?? []).filter((c) => !parsed.cityStays!.some((x) => x.when === c.when));
    next.city_stays = [...keep, ...parsed.cityStays];
    for (const c of parsed.cityStays) chips.push(`${c.nights} night${c.nights === 1 ? "" : "s"} in ${c.city} ${c.when === "before" ? "before the safari" : "at the end"}${c.want_extras?.length ? ` with ${c.want_extras.join(", ")}` : ""}`);
  }
  // a city hotel from Master data named in the message: "1 night in Delhi at Roseate House"
  if (f.pending !== "hotel") {
    next.city_stays = (next.city_stays ?? []).map((c) => {
      if (c.hotel) return c;
      const h = cityHotelNamed(msg, full, c.city);
      if (!h) return c;
      chips.push(`${c.city}: ${h.name}`);
      return { ...c, hotel: h.name };
    });
  }

  // ---- corrections to the order: "wrong direction", "Pench first", "Kanha then Pench"
  const aiOrder = (parsed.order ?? []).map((n) => ctx.pricing.parks.find((p) => p.name === n)?.id).filter((x): x is string => !!x && next.stops.some((s) => s.park_id === x));
  if (aiOrder.length && next.stops.length > 1 && !parsed.reverse) {
    const named = aiOrder.flatMap((id) => next.stops.filter((s) => s.park_id === id));
    next.stops = [...named, ...next.stops.filter((s) => !aiOrder.includes(s.park_id))];
    chips.push(`new order: ${next.stops.map((s) => parkName(s.park_id).split(/[ -]/)[0]).join(" then ")}`);
  } else if (parsed.reverse && next.stops.length > 1) {
    next.stops = [...next.stops].reverse();
    // swap the way in and out only when both are known
    if (next.arrival_location_id && next.departure_location_id) {
      [next.arrival_location_id, next.departure_location_id] = [next.departure_location_id, next.arrival_location_id];
    }
    chips.push(`route reversed: ${next.stops.map((st) => parkName(st.park_id).split(/[ -]/)[0]).join(" then ")}`);
  } else if (parsed.parks.length && parsed.parks.every((p) => !p.nights) && next.stops.length > 1 && /\b(first|start|begin|before|then|after|last|end|order|instead|pehle|phir|baad)\b/.test(low)) {
    const ids = parsed.parks.map((p) => matchByName(ctx.pricing.parks, p.name, aliasesOf)?.id).filter((x): x is string => !!x && next.stops.some((s) => s.park_id === x));
    if (ids.length === 1 && /\b(last|end)\b/.test(low)) {
      next.stops = [...next.stops.filter((s) => s.park_id !== ids[0]), next.stops.find((s) => s.park_id === ids[0])!];
      chips.push(`${parkName(ids[0])} last`);
    } else if (ids.length >= 1) {
      const named = ids.map((id) => next.stops.find((s) => s.park_id === id)!);
      next.stops = [...named, ...next.stops.filter((s) => !ids.includes(s.park_id))];
      chips.push(`new order: ${next.stops.map((s) => parkName(s.park_id).split(/[ -]/)[0]).join(" then ")}`);
    }
  }

  // ---- a short reply naming a room type ("treehouse", "cottage"): the stop the
  // last question was about, or every stop that has such a room
  const roomWord = roomWishIn(low);
  if (roomWord && !parsed.parks.length) {
    const targets = f.pending === "room" && f.roomFor ? next.stops.filter((s) => s.park_id === f.roomFor) : next.stops;
    for (const s of targets) {
      const i = next.stops.indexOf(s);
      const want = pickRoom(roomsOf(ctx, s.property_id), roomWord);
      if (want && want.id !== s.room_category_id) {
        const meals = mealPlansOf(ctx, want.id);
        next.stops[i] = { ...s, room_category_id: want.id, meal_plan: meals.includes(s.meal_plan) ? s.meal_plan : meals[0] ?? s.meal_plan };
      }
      if (want) {
        chips.push(`${want.name} at ${ctx.properties.find((x) => x.id === s.property_id)?.name}`);
        f.roomDecided = [...new Set([...(f.roomDecided ?? []), s.park_id])];
      }
    }
  }
  for (let i = 0; i < next.stops.length && !parsed.parks.length && !roomWord; i++) {
    const s = next.stops[i];
    const match = roomsOf(ctx, s.property_id).find((r) => {
      const core = r.name.toLowerCase().replace(/\b(ac|deluxe|room)\b/g, "").replace(/\s+/g, " ").trim();
      return core.length >= 4 && (low.includes(core) || low.includes(core.replace(/\s/g, "")));
    });
    if (match && match.id !== s.room_category_id) {
      const meals = mealPlansOf(ctx, match.id);
      next.stops[i] = { ...s, room_category_id: match.id, meal_plan: meals.includes(s.meal_plan) ? s.meal_plan : meals[0] ?? s.meal_plan };
      chips.push(`${match.name} at ${ctx.properties.find((x) => x.id === s.property_id)?.name}`);
    }
  }

  // ---- meal plan for every stop that offers it
  if (parsed.meal_plan) {
    next.stops = next.stops.map((s) => (mealPlansOf(ctx, s.room_category_id).includes(parsed.meal_plan!) ? { ...s, meal_plan: parsed.meal_plan! } : s));
    chips.push(`meal plan ${parsed.meal_plan}`);
  }

  // ---- a message that is just a person's name, e.g. "Judy & Cathy Miller"
  const looksLikeName = /^((mr|mrs|ms|miss|dr)\.?\s+)?[A-Z][a-zA-Z'-]+(\s*(&|and)\s*[A-Z][a-zA-Z'-]+)*(\s+[A-Z][a-zA-Z'-]+)+$/.test(msg);
  if (!chips.length && !parsed.parks.length && !next.guest.name.trim() && looksLikeName && f.pending !== "name") {
    next.guest.name = msg;
    chips.push(`guest ${msg}`);
  }

  // ---- a plain answer to "what is the guest's name?"
  if (f.pending === "name" && !chips.length && !parsed.parks.length && msg.length <= 60 && !/\d/.test(msg) && !/^(yes|no|ok|okay)\b/i.test(msg)) {
    next.guest.name = msg.replace(/^(it'?s|its|name is)\s+/i, "").trim();
    chips.push(`guest ${next.guest.name}`);
  }

  const understood = chips.length > 0;

  // ---- rebuild the day plan when the route changed
  const routeChanged = routeKey(next) !== routeKey(plan);
  if (routeChanged) {
    // the days need every hotel (Roseate House for its rates and transfers), not only the safari lodges
    next.days = next.stops.length && !routeProblems(next, ctx).length ? buildDays(next, full) : [];
  }

  // questions that close on their own once the plan has the answer
  f.asks = (f.asks ?? []).filter((a) => !(a.until === "date" && (f.dateSet || next.dateless)) && !(a.until === "nights" && !f.nightsUnknown.length && next.stops.length) && !(a.until === "adults" && f.adultsSet));

  const step = nextQuestion(next, f, full, today);
  f.pending = step.pending;
  f.roomFor = step.roomFor ?? null;
  f.hotelFor = step.hotelFor ?? null;
  f.askFor = step.askFor ?? null;

  let text = step.text;
  if (!understood) {
    text = /^(yes|ok|okay|looks good|go ahead|review|next|done|perfect|great)\b/i.test(low) && step.ready
      ? "Opening the plan for review."
      : `I did not catch any trip details there. Try writing it like "Kanha 3 nights, Bandhavgarh 2 nights, 2 adults, arriving Jabalpur 10 Feb". ${step.text}`;
  }
  const action = !understood && step.ready && /^(yes|ok|okay|looks good|go ahead|review|next|done|perfect|great)\b/i.test(low) ? "review" : undefined;

  return {
    plan: next,
    flags: f,
    reply: { role: "assistant", text, chips, warnings: [...warnings, ...step.warnings], quick: step.quick, action, checklist: tripChecklist(next, f, full) },
    understood,
    routeChanged,
  };
}

// What to ask next, or the price once everything is known.
export function nextQuestion(
  plan: Plan,
  f: ChatFlags,
  full: BuilderContext,
  today: ISODate
): { text: string; pending: ChatFlags["pending"]; quick?: QuickReply[]; warnings: string[]; ready: boolean; roomFor?: string; hotelFor?: string; askFor?: string } {
  const ctx = safariOnly(full);
  const parks = ctx.pricing.parks.filter((p) => lodgesInPark(ctx, p.id).length);
  if (!plan.stops.length) {
    return {
      text: 'Which parks, and how many nights in each? For example "Kanha 3 nights, Bandhavgarh 2 nights".',
      pending: "parks",
      quick: parks.slice(0, 6).map((p) => ({ label: shortName(p.name), text: `${shortName(p.name)} 3 nights` })),
      warnings: [],
      ready: false,
    };
  }
  const problems = routeProblems(plan, ctx);
  if (problems.length) return { text: `I cannot plan this yet: ${problems.join(" ")}`, pending: null, warnings: [], ready: false };
  const askOf = (key: string) => (f.asks ?? []).find((a) => a.key === key);
  if (f.nightsUnknown.length) {
    const n = ctx.pricing.parks.find((p) => p.id === f.nightsUnknown[0])?.name ?? "the park";
    const split = askOf("split");
    return {
      text: `${split ? `${split.text} ` : ""}How many nights in ${n}? (2 for now)`,
      pending: "nights",
      quick: [1, 2, 3, 4].map((x) => ({ label: `${x} night${x === 1 ? "" : "s"}`, text: String(x) })),
      warnings: [],
      ready: false,
    };
  }
  if (!f.dateSet) {
    const vague = askOf("date");
    return {
      text: vague ? vague.text : "When do they arrive? For example 16 Jan 2027.",
      pending: "date",
      quick: vague ? [{ label: "Dates not fixed", text: "dates not fixed" }] : undefined,
      warnings: [],
      ready: false,
    };
  }
  if (!f.adultsSet) {
    return {
      text: 'How many guests? Adults, and children with their ages, for example "2 adults and a child aged 8".',
      pending: "adults",
      quick: [1, 2, 3, 4].map((x) => ({ label: `${x} adult${x === 1 ? "" : "s"}`, text: `${x} adult${x === 1 ? "" : "s"}` })),
      warnings: [],
      ready: false,
    };
  }
  if (!f.arrivalAsked && !plan.arrival_location_id) {
    return {
      text: 'Where will they arrive? Pick a place, or say "on their own" if they reach the lodge themselves.',
      pending: "arrival",
      quick: [...placesOf(ctx).slice(0, 5).map((l) => ({ label: l.name, text: `arriving at ${l.name}` })), { label: "On their own", text: "on their own" }],
      warnings: [],
      ready: false,
    };
  }
  // The way out is asked separately: guests often fly in and out of different cities.
  if (!f.departureAsked && plan.arrival_location_id && !plan.departure_location_id) {
    const arrName = ctx.locations.find((l) => l.id === plan.arrival_location_id)?.name ?? "the same place";
    return {
      text: `Where do they leave from at the end? The same place (${arrName}), or somewhere else?`,
      pending: "departure",
      quick: [
        { label: `Same: ${arrName}`, text: "same" },
        ...placesOf(ctx).filter((l) => l.id !== plan.arrival_location_id).slice(0, 4).map((l) => ({ label: l.name, text: `leaving from ${l.name}` })),
        { label: "On their own", text: "leaving on their own" },
      ],
      warnings: [],
      ready: false,
    };
  }
  // Came in their own vehicle: how do they leave (never assumed when there are several lodges)?
  if (!f.departureAsked && plan.arrival_mode === "own" && !plan.own_vehicle && !plan.departure_location_id && !plan.departure_mode) {
    return {
      text: "How do they leave at the end: in their own vehicle, or do we drop them at an airport or station?",
      pending: "departure",
      quick: [{ label: "Own vehicle", text: "leaving in their own vehicle" }, ...placesOf(ctx).slice(0, 4).map((l) => ({ label: l.name, text: `leaving from ${l.name}` }))],
      warnings: [],
      ready: false,
    };
  }
  // Their own vehicle on the way in or out: between the lodges too? Asked, not assumed.
  if (plan.stops.length > 1 && !plan.own_vehicle && !plan.between_lodges && !f.legAsked && (plan.arrival_mode === "own" || plan.departure_mode === "own")) {
    const route = plan.stops.map((s) => shortName(ctx.pricing.parks.find((p) => p.id === s.park_id)?.name ?? "")).join(" to ");
    return {
      text: `Between the lodges (${route}): our car, or their own vehicle?`,
      pending: "leg",
      quick: [{ label: "Our car", text: "our car" }, { label: "Their own vehicle", text: "their own vehicle" }],
      warnings: [],
      ready: false,
    };
  }
  // Which lodge, where a park has more than one of ours (Bandhavgarh: Kings Lodge or Tree House Hideaway).
  const lodgeStop = plan.stops.find((s) => !(f.lodgeDecided ?? []).includes(s.park_id) && lodgesInPark(ctx, s.park_id).length > 1);
  if (lodgeStop) {
    const park = ctx.pricing.parks.find((p) => p.id === lodgeStop.park_id)?.name ?? "this park";
    const lodges = lodgesInPark(ctx, lodgeStop.park_id);
    const names = lodges.map((l) => l.name);
    return {
      text: `Which lodge in ${park}: ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`,
      pending: "lodge",
      quick: lodges.map((l) => ({ label: l.name, text: l.name })),
      warnings: [],
      ready: false,
    };
  }
  // Which room, where a lodge has more than one type (Cottage / Tree House / Forest Suite...).
  const roomStop = plan.stops.find((s) => !(f.roomDecided ?? []).includes(s.park_id) && roomsOf(ctx, s.property_id).length > 1);
  if (roomStop) {
    const lodge = ctx.properties.find((p) => p.id === roomStop.property_id)?.name ?? "the lodge";
    const rooms = roomsOf(ctx, roomStop.property_id);
    const label = (n: string) => n.replace(/^AC\s+/i, "");
    const names = rooms.map((r) => label(r.name));
    return {
      text: rooms.length === 2 ? `${names[0]} or ${names[1]} at ${lodge}?` : `Which room at ${lodge}: ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`,
      pending: "room",
      roomFor: roomStop.park_id,
      quick: rooms.map((r) => ({ label: label(r.name), text: label(r.name).toLowerCase() })),
      warnings: [],
      ready: false,
    };
  }

  // The hotel for nights in a city (Delhi) before or after the safari.
  const hotelStay = [...(plan.city_stays ?? [])]
    .sort((a, b) => (a.when === b.when ? 0 : a.when === "before" ? -1 : 1))
    .find((c) => !c.hotel && !(f.hotelAsked ?? []).includes(`${c.when}:${c.city}`));
  if (hotelStay) {
    const other = (plan.city_stays ?? []).find((c) => c !== hotelStay && c.city === hotelStay.city && c.hotel);
    return {
      text: `Which hotel in ${hotelStay.city} (${hotelStay.nights} night${hotelStay.nights === 1 ? "" : "s"} ${hotelStay.when === "before" ? "before the safari" : "at the end"})? Give the name and the price per night for all rooms, e.g. "The Imperial, 18000", or say "to be confirmed".`,
      pending: "hotel",
      hotelFor: `${hotelStay.when}:${hotelStay.city}`,
      quick: [
        ...(other ? [{ label: `Same: ${other.hotel}`, text: `${other.hotel}${other.price ? `, ${other.price}` : ""}` }] : []),
        // the hotels in this city from Master data
        ...cityHotels(full)
          .filter((h) => sameCity(h.city, hotelStay.city) && h.name !== other?.hotel)
          .slice(0, 3)
          .map((h) => ({ label: h.name, text: h.name })),
        { label: "To be confirmed", text: "to be confirmed" },
      ],
      warnings: [],
      ready: false,
    };
  }

  // What the reader found unclear (fishing half or full day, which flight, a touring package...): one at a time.
  const open = (f.asks ?? []).find((a) => !a.until);
  if (open) {
    return {
      text: open.text,
      pending: "ask",
      askFor: open.key,
      quick: open.quick?.map((q) => ({ label: q, text: q })),
      warnings: [],
      ready: false,
    };
  }

  const r = priceTrip(planToTrip(plan, today), full.pricing);
  if (r.errors.length) {
    return { text: "Before I can quote this, please check:", pending: null, warnings: r.errors, ready: false };
  }
  const stillNeeded = plan.manual_prices ? r.missing.filter((m) => plan.manual_prices[m.key] === undefined) : r.missing;
  const missingNote = stillNeeded.length
    ? [
        `${stillNeeded.length} price${stillNeeded.length === 1 ? " is" : "s are"} not in master data yet: ${stillNeeded.map((m) => m.label).join("; ")}. ` +
          `You can type ${stillNeeded.length === 1 ? "it" : "them"} on the Plan & price step, save a draft and finish later, or say "on their own" for transfers.`,
      ]
    : [];
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0) + (plan.city_stays ?? []).reduce((t, c) => t + c.nights, 0); // lodges + city nights
  const safaris = plan.days.reduce((t, d) => t + d.safaris.length, 0);
  const guests = plan.guest.adults + plan.guest.children.length;
  let text =
    `${nights} night${nights === 1 ? "" : "s"}, ${safaris} safari${safaris === 1 ? "" : "s"}, ${guests} guest${guests === 1 ? "" : "s"} in ${plan.guest.rooms} room${plan.guest.rooms === 1 ? "" : "s"}. ` +
    `${stillNeeded.length ? "Total so far" : "Total"} ${rupees(r.totals.grand)} (${paxText(r.perPerson, r.split, rupees)})${stillNeeded.length ? ", without the missing prices" : ""}.`;
  let pending: ChatFlags["pending"] = null;
  if (!plan.guest.name.trim()) {
    text += " What is the guest's name? It is needed to save.";
    pending = "name";
  } else {
    text += ' Tell me any change, like "make Pench 2 nights" or "add Kanha 3 nights", or review the plan.';
  }
  const natNote = plan.guest.country ? [] : ['Nationality not given, so foreign safari rates are used. Say "Indian guests" or the country, e.g. "from UK".'];
  return { text, pending, quick: [{ label: "Review the plan", action: "review" }], warnings: [...natNote, ...missingNote, ...r.warnings], ready: true };
}
