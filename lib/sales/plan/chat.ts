// =====================================================================
// The trip assistant: a conversation that builds the plan step by step.
// Each message is read by the built-in reader (and optionally the AI
// fallback), MERGED into the current plan (not replacing it), and the
// assistant replies with what it understood and the next thing it needs.
// Pure function, so it is easy to test and runs instantly in the browser.
// =====================================================================

import { rupees } from "@/lib/sales/format";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { ISODate } from "@/lib/sales/pricing/types";
import { aliasesOf, extractTrip, locationAliases, matchByName, mergeParsed, type ParsedTrip } from "./parse-text";
import { buildDays, defaultStop, emptyPlan, lodgesInPark, mealPlansOf, planToTrip, roomsOf, routeKey, routeProblems } from "./planner";
import type { BuilderContext, Plan } from "./types";

export interface ChatFlags {
  dateSet: boolean;
  adultsSet: boolean;
  roomsSet: boolean;
  arrivalAsked: boolean;
  nightsUnknown: string[]; // park ids added without a number of nights
  pending: "parks" | "nights" | "date" | "adults" | "arrival" | "name" | null;
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

export function initialFlags(plan: Plan): ChatFlags {
  const editing = plan.stops.length > 0;
  return { dateSet: editing, adultsSet: editing, roomsSet: editing, arrivalAsked: editing, nightsUnknown: [], pending: editing ? null : "parks" };
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
  ctx: BuilderContext,
  today: ISODate,
  aiParsed?: ParsedTrip
): ChatResult {
  const msg = message.trim();
  const low = msg.toLowerCase();

  if (/^(start over|start again|reset|new trip|clear( all)?)\b/.test(low)) {
    const fresh = emptyPlan(today);
    return {
      plan: fresh,
      flags: initialFlags(fresh),
      reply: { role: "assistant", text: "Starting fresh. " + greeting(fresh).text },
      understood: true,
      routeChanged: true,
    };
  }

  const next: Plan = JSON.parse(JSON.stringify(plan));
  const f: ChatFlags = { ...flags, nightsUnknown: [...flags.nightsUnknown] };
  const chips: string[] = [];
  const warnings: string[] = [];
  const parkName = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? "the park";

  // ---- guest contact details
  const email = msg.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (email) {
    next.guest.email = email[0];
    chips.push(`email ${email[0]}`);
  }
  const phone = msg.match(/(?:\+|\b)\d[\d\s-]{8,}\d\b/);
  if (phone && phone[0].replace(/\D/g, "").length >= 10) {
    next.guest.phone = phone[0].trim();
    chips.push(`phone ${next.guest.phone}`);
  }
  const nameM =
    msg.match(/\b(?:guest(?:'s)?\s+name|name)\s*(?:is|:|-)\s*([^,.;\n]{2,60})/i) ??
    msg.match(/\bfor\s+((?:mr|mrs|ms|miss|dr)\.?\s+[A-Za-z][^,.;\n]{1,50})/i) ??
    msg.match(/^((?:mr|mrs|ms|miss|dr)\.?\s+[A-Za-z][A-Za-z&' -]{1,40}?)\s*(?=[,;\n]|$)/i); // "Mr Shah, 2 adults..."
  if (nameM) {
    next.guest.name = nameM[1].trim();
    chips.push(`guest ${next.guest.name}`);
  }

  // ---- "on their own": no pick-up or drop
  if (/\b(on (their|his|her) own|self[- ]?drive|own (car|vehicle|transport)|no (pick ?up|transfers?|airport))\b/.test(low)) {
    next.arrival_location_id = null;
    next.departure_location_id = null;
    f.arrivalAsked = true;
    chips.push("no airport or station transfers");
  }

  // ---- removing parks: "remove Pench", "without Satpura", "instead of Pench"
  const removed = new Set<string>();
  for (const park of ctx.pricing.parks) {
    for (const a of aliasesOf(park.name)) {
      const re = new RegExp(`\\b(remove|drop|skip|without|delete|cancel|exclude|no|instead of|replace)\\s+(the\\s+)?${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(msg) && next.stops.some((s) => s.park_id === park.id)) {
        next.stops = next.stops.filter((s) => s.park_id !== park.id);
        f.nightsUnknown = f.nightsUnknown.filter((x) => x !== park.id);
        removed.add(park.name);
        chips.push(`removed ${park.name}`);
        break;
      }
    }
  }

  // ---- read the message
  let parsed = extractTrip(msg, ctx, today);
  if (aiParsed) parsed = mergeParsed(parsed, aiParsed);
  parsed.parks = parsed.parks.filter((p) => !removed.has(p.name));
  warnings.push(...parsed.notes.filter((n) => !n.startsWith("Assumed the guest also leaves")));

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
  if (parsed.nationality) {
    next.guest.nationality = parsed.nationality;
    chips.push(parsed.nationality === "indian" ? "Indian guests" : "foreign guests");
  }

  // ---- dates
  if (parsed.arrival_date) {
    if (parsed.arrival_date < today) warnings.push(`${parsed.arrival_date} is in the past. Please check the date.`);
    next.arrival_date = parsed.arrival_date;
    f.dateSet = true;
    chips.push(`arriving ${parsed.arrival_date}`);
  } else if (f.pending === "date" && !chips.length && !parsed.parks.length) {
    warnings.push('I could not read a date there. Try "16 Jan 2027" or "16/01/2027".');
  }

  // ---- arrival and departure points
  const places = placesOf(ctx);
  const arr = matchByName(places, parsed.arrival_place, locationAliases);
  const dep = matchByName(places, parsed.departure_place, locationAliases);
  if (arr) {
    next.arrival_location_id = arr.id;
    f.arrivalAsked = true;
    chips.push(`arriving via ${arr.name}`);
  }
  if (dep) {
    next.departure_location_id = dep.id;
    chips.push(`leaving via ${dep.name}`);
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
    const idx = next.stops.findIndex((s) => s.park_id === park.id);
    if (idx < 0 && !lodgesInPark(ctx, park.id).length) {
      warnings.push(`No lodge is set up in ${park.name} yet, so it cannot be added. Add one in Master data.`);
      continue;
    }
    if (idx < 0) {
      next.stops.push(defaultStop(ctx, park.id, p.nights ?? 2));
      if (!p.nights) f.nightsUnknown.push(park.id);
    } else if (p.nights) {
      next.stops[idx] = { ...next.stops[idx], nights: p.nights };
      f.nightsUnknown = f.nightsUnknown.filter((x) => x !== park.id);
    }
    const i = next.stops.findIndex((s) => s.park_id === park.id);
    if (p.lodge) {
      const lodge = lodgesInPark(ctx, park.id).find((l) => l.name.toLowerCase() === p.lodge!.toLowerCase());
      if (lodge && lodge.id !== next.stops[i].property_id) {
        const room = roomsOf(ctx, lodge.id)[0];
        next.stops[i] = { ...next.stops[i], property_id: lodge.id, room_category_id: room?.id ?? "", meal_plan: room ? mealPlansOf(ctx, room.id)[0] ?? "AP" : "AP" };
      }
    }
    const stop = next.stops[i];
    const lodgeName = ctx.properties.find((x) => x.id === stop.property_id)?.name;
    chips.push(`${park.name} ${p.nights ? `${stop.nights} night${stop.nights === 1 ? "" : "s"}` : "(nights to confirm)"}${lodgeName ? ` at ${lodgeName}` : ""}`);
  }

  // ---- room type by name: "treehouse", "cottage"
  for (let i = 0; i < next.stops.length; i++) {
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
    next.days = next.stops.length && !routeProblems(next, ctx).length ? buildDays(next, ctx) : [];
  }

  const step = nextQuestion(next, f, ctx, today);
  f.pending = step.pending;

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
    reply: { role: "assistant", text, chips, warnings: [...warnings, ...step.warnings], quick: step.quick, action },
    understood,
    routeChanged,
  };
}

// What to ask next, or the price once everything is known.
export function nextQuestion(
  plan: Plan,
  f: ChatFlags,
  ctx: BuilderContext,
  today: ISODate
): { text: string; pending: ChatFlags["pending"]; quick?: QuickReply[]; warnings: string[]; ready: boolean } {
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
  if (f.nightsUnknown.length) {
    const n = ctx.pricing.parks.find((p) => p.id === f.nightsUnknown[0])?.name ?? "the park";
    return { text: `How many nights in ${n}? (2 for now)`, pending: "nights", quick: [1, 2, 3, 4].map((x) => ({ label: `${x} night${x === 1 ? "" : "s"}`, text: String(x) })), warnings: [], ready: false };
  }
  if (!f.dateSet) return { text: "When do they arrive? For example 16 Jan 2027.", pending: "date", warnings: [], ready: false };
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
      quick: [...placesOf(ctx).slice(0, 5).map((l) => ({ label: l.name, text: `${l.name} in and out` })), { label: "On their own", text: "on their own" }],
      warnings: [],
      ready: false,
    };
  }

  const r = priceTrip(planToTrip(plan, today), ctx.pricing);
  if (r.errors.length) {
    const hints = r.errors.map((e) =>
      e.startsWith("No transfer rate")
        ? `${e} Add it in Master data > Transfer rates, or say "on their own".`
        : e.startsWith("No ") && e.includes("rate for")
          ? `${e} Add it in Master data, or change the dates.`
          : e
    );
    return { text: "Almost there. Before I can quote this:", pending: null, warnings: hints, ready: false };
  }
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);
  const safaris = plan.days.reduce((t, d) => t + d.safaris.length, 0);
  const guests = plan.guest.adults + plan.guest.children.length;
  let text =
    `${nights} night${nights === 1 ? "" : "s"}, ${safaris} safari${safaris === 1 ? "" : "s"}, ${guests} guest${guests === 1 ? "" : "s"} in ${plan.guest.rooms} room${plan.guest.rooms === 1 ? "" : "s"}. ` +
    `Total ${rupees(r.totals.grand)} (${rupees(r.perPerson)} per person).`;
  let pending: ChatFlags["pending"] = null;
  if (!plan.guest.name.trim()) {
    text += " What is the guest's name? It is needed to save.";
    pending = "name";
  } else {
    text += ' Tell me any change, like "make Pench 2 nights" or "add Kanha 3 nights", or review the plan.';
  }
  return { text, pending, quick: [{ label: "Review the plan", action: "review" }], warnings: r.warnings, ready: true };
}
