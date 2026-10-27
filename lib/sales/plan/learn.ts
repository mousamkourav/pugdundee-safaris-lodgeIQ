// =====================================================================
// Learning from corrections. When a quote is saved, the enquiry is read again by
// the built-in reader alone and compared with the plan that was saved. Where the
// sales person changed what the reader filled in (the lodge, a park it missed,
// nights, safaris, their own vehicle, the arrival place, the room), the word in the
// enquiry the reader could not place, nearest to that part, is suggested as a
// rule: phrase -> meaning. A Sales admin approves it in Master data; approved rules
// are read before anything else (applyRules in parse-text.ts).
// Pure, so it is tested without a database.
// =====================================================================

import type { ISODate } from "@/lib/sales/pricing/types";
import { chatTurn, initialFlags } from "./chat";
import { aliasesOf, lodgeAliases, unknownWordsAt } from "./parse-text";
import { emptyPlan } from "./planner";
import { safariOnly } from "./cities";
import type { BuilderContext, Plan } from "./types";

export type RuleKind = "park" | "lodge" | "nights" | "safaris" | "transport" | "place" | "room";
export interface RuleSuggestion {
  phrase: string;
  meaning: string;
  kind: RuleKind;
}

export function suggestRules(enquiry: string, saved: Plan, full: BuilderContext, today: ISODate): RuleSuggestion[] {
  const text = enquiry.replace(/\s+/g, " ").trim();
  if (text.length < 8 || !saved.stops.length) return [];
  const ctx = safariOnly(full);
  const first = emptyPlan(today);
  const read = chatTurn(first, initialFlags(first), text, full, today).plan;
  const low = text.toLowerCase();
  const unknown = unknownWordsAt(text, full).filter((u) => u.phrase.length >= 2);
  const used = new Set<number>();
  const out: RuleSuggestion[] = [];

  // the unknown phrase nearest to a position (after it first: "kanha 3 ratri", "kanha in xyz")
  const nearest = (at: number | null, within = 60) => {
    const free = unknown.map((u, i) => ({ ...u, i })).filter((u) => !used.has(u.i));
    const pick = at === null ? free[0] : free.filter((u) => Math.abs(u.at - at) <= within).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    if (pick) used.add(pick.i);
    return pick?.phrase;
  };
  const suggest = (phrase: string | undefined, meaning: string, kind: RuleKind) => {
    if (!phrase || !meaning || out.some((o) => o.phrase === phrase)) return;
    out.push({ phrase, meaning, kind });
  };
  // where a park (or one of its lodges) is written in the enquiry
  const parkAliases = ctx.pricing.parks.flatMap((p) => aliasesOf(p.name));
  const mentionOf = (parkId: string) => {
    const park = ctx.pricing.parks.find((p) => p.id === parkId);
    if (!park) return null;
    const names = [...aliasesOf(park.name), ...ctx.properties.filter((l) => l.park_id === parkId).flatMap((l) => lodgeAliases(l.name, parkAliases))];
    const hits = names.map((a) => low.search(new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`))).filter((x) => x >= 0);
    return hits.length ? Math.min(...hits) : null;
  };
  const lodgeName = (id: string) => ctx.properties.find((p) => p.id === id)?.name ?? "";
  const parkName = (id: string) => ctx.pricing.parks.find((p) => p.id === id)?.name ?? "";

  // stops the reader missed, in trip order: each takes the next unknown phrase not used yet
  const missed = saved.stops.filter((s) => !read.stops.some((r) => r.park_id === s.park_id));
  for (const s of missed) suggest(nearest(null), lodgeName(s.property_id) || parkName(s.park_id), lodgeName(s.property_id) ? "lodge" : "park");

  for (const s of saved.stops) {
    const r = read.stops.find((x) => x.park_id === s.park_id && (x.property_id === s.property_id || !read.stops.some((y) => y.property_id === s.property_id)));
    if (!r) continue;
    const at = mentionOf(s.park_id);
    if (at === null) continue;
    // another lodge in the same park ("bag tree" -> Tree House Hideaway)
    if (r.property_id !== s.property_id && lodgeName(s.property_id)) suggest(nearest(at), lodgeName(s.property_id), "lodge");
    // a word for nights or safaris after a number: "kanha 3 ratri", "4 rides"
    const seg = low.slice(at, at + 40);
    const counted = (n: number) => seg.match(new RegExp(`\\b${n}\\s*([a-z]{3,})\\b`));
    if (r.nights !== s.nights) {
      const m = counted(s.nights);
      const word = m && unknown.find((u, i) => !used.has(i) && u.phrase === m[1]);
      if (word) {
        used.add(unknown.indexOf(word));
        suggest(word.phrase, "nights", "nights");
      }
    }
    if (s.want_safaris != null && r.want_safaris !== s.want_safaris) {
      const m = counted(s.want_safaris);
      const word = m && unknown.find((u, i) => !used.has(i) && u.phrase === m[1]);
      if (word) {
        used.add(unknown.indexOf(word));
        suggest(word.phrase, "safaris", "safaris");
      }
    }
    if (r.room_category_id !== s.room_category_id) {
      const room = ctx.rooms.find((x) => x.id === s.room_category_id)?.name;
      if (room && roomsDiffer(ctx, s.property_id)) suggest(nearest(at, 40), room, "room");
    }
  }

  // their own vehicle, where the reader planned our transfers
  const own = (p: Plan) => !!p.own_vehicle || p.arrival_mode === "own" || p.departure_mode === "own" || p.between_lodges === "own";
  if (own(saved) && !own(read)) suggest(nearest(null), "own vehicle", "transport");

  // the arrival place, where the reader found none
  if (saved.arrival_location_id && !read.arrival_location_id && !own(saved)) {
    const name = full.locations.find((l) => l.id === saved.arrival_location_id)?.name;
    if (name) suggest(nearest(null), name, "place");
  }
  return out.slice(0, 5);
}

const roomsDiffer = (ctx: BuilderContext, propertyId: string) => ctx.rooms.filter((r) => r.property_id === propertyId).length > 1;

// Rows for sales_reader_rules: suggested rules from a correction, and words the reader
// could not place (meaning left for an admin). Text is already free of names and contacts.
export function readerRows(suggestions: RuleSuggestion[], unknown: string[], example: string) {
  const ex = example.slice(0, 500);
  return [
    ...suggestions.map((s) => ({ phrase: s.phrase, meaning: s.meaning, kind: s.kind, source: "correction" as const, example: ex })),
    ...unknown.filter((u) => !suggestions.some((s) => s.phrase === u)).map((u) => ({ phrase: u, meaning: null, kind: "word" as const, source: "unknown" as const, example: ex })),
  ].filter((r) => r.phrase.length >= 2 && r.phrase.length <= 80);
}
