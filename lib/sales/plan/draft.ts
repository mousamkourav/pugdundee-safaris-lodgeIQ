// The guest-facing sections of an itinerary (title, intro, inclusions,
// exclusions, notes, terms). Shared by the builder's Final draft step and the
// public client page, so both always show the same text.
import type { CancellationSlab, ContentBlock, Plan, PlanDraft } from "./types";

export interface DraftSections {
  title: string; // the catchy headline on the cover
  routeLine: string; // "Satpura, Pench, Kanha, Bandhavgarh & Tadoba"
  about: string;
  inclusions: string[];
  exclusions: string[];
  notes: string[];
  paymentTerms: string;
  cancellation: string[];
}

export interface DraftInputs {
  parkNames: Record<string, string>;
  lodgeNames: Record<string, string>;
  blocks: ContentBlock[];
  cancellationSlabs: CancellationSlab[];
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.replace(/^[-*\u2022]\s*/, "").trim())
    .filter(Boolean);

// The same line from several parks or lodges ("The park is closed on Wednesday
// afternoons...") is shown once.
const unique = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const MEALS: Record<string, string> = { AP: "all meals", MAP: "breakfast and dinner", CP: "breakfast", EP: "room only" };

// "Tadoba-Andhari Tiger Reserve" -> "Tadoba", "Pench National Park" -> "Pench"
export const shortPark = (name: string) =>
  name
    .replace(/\b(national park|tiger reserve|wildlife sanctuary|sanctuary|reserve forest)\b/gi, "")
    .replace(/-andhari/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const HEADLINES = [
  "Into the Heart of Tiger Country",
  "On the Trail of the Tiger",
  "Where the Wild Tigers Roam",
  "Journey Through Tiger Country",
  "Footprints in the Sal Forest",
  "Tigers, Forests and Starlit Nights",
];

// The same headline every time for a given route (it can be changed on Final draft).
export function headlineFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HEADLINES[h % HEADLINES.length];
}

export function defaultDraft(plan: Plan, inp: DraftInputs): DraftSections {
  const parkIds = [...new Set(plan.stops.map((s) => s.park_id))];
  const lodgeIds = [...new Set(plan.stops.map((s) => s.property_id))];
  const parks = parkIds.map((id) => inp.parkNames[id]).filter(Boolean);
  const lodges = lodgeIds.map((id) => inp.lodgeNames[id]).filter(Boolean);
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);
  const safaris = plan.days.reduce((t, d) => t + d.safaris.length, 0);

  // The generic block of a kind (default first), plus blocks for these parks/lodges.
  const textsFor = (kind: string) => {
    const generic = inp.blocks.filter((b) => b.kind === kind && !b.park_id && !b.property_id);
    const main = generic.find((b) => b.is_default) ?? generic[0];
    const specific = inp.blocks.filter(
      (b) => b.kind === kind && ((b.park_id && parkIds.includes(b.park_id)) || (b.property_id && lodgeIds.includes(b.property_id)))
    );
    return [main, ...specific].filter((b): b is ContentBlock => !!b).map((b) => b.body);
  };

  const inclusions = unique(textsFor("inclusions").flatMap(lines));
  const exclusions = unique(textsFor("exclusions").flatMap(lines));
  const cancellation = unique(textsFor("cancellation_terms").flatMap(lines));

  return {
    title: parks.length ? headlineFor(parkIds.join("|")) : "Your safari",
    routeLine: (() => {
      const names = [...new Set(parks.map(shortPark))];
      return names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0] ?? "";
    })(),
    about:
      textsFor("about_trip")[0] ??
      (nights
        ? (() => {
            const shortParks = [...new Set(parks.map(shortPark))];
            const parkList = shortParks.length > 1 ? `${shortParks.slice(0, -1).join(", ")} and ${shortParks[shortParks.length - 1]}` : shortParks[0];
            const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
            const stay = lodges.length <= 3 ? lodges.join(lodges.length === 2 ? " and " : ", ") : `${words[lodges.length] ?? lodges.length} of our handpicked wildlife lodges`;
            return `A ${nights}-night journey through ${parkList}, staying at ${stay}.`;
          })()
        : ""),
    inclusions: inclusions.length
      ? inclusions
      : [
          `${nights} nights at ${lodges.join(" and ")}`,
          ...[...new Set(plan.stops.map((s) => s.meal_plan))].map((m) => `Meals: ${MEALS[m] ?? m}`),
          ...(safaris ? [`${safaris} jeep safaris with park guide`] : []),
          ...(plan.days.some((d) => d.transfer) ? ["Road transfers shown in the itinerary"] : []),
          "Applicable taxes",
        ],
    exclusions: exclusions.length
      ? exclusions
      : ["Flights and train tickets", "Drinks, laundry and personal expenses", "Tips and gratuities", "Anything not listed under inclusions"],
    notes: unique(textsFor("important_notes").flatMap(lines)),
    paymentTerms: textsFor("payment_terms").join("\n"),
    cancellation: cancellation.length
      ? cancellation
      : inp.cancellationSlabs
          .slice()
          .sort((a, b) => a.min_days - b.min_days)
          .map((c) =>
            c.max_days == null
              ? `${c.min_days} days or more before arrival: ${c.pct}% of the total`
              : c.min_days === 0
                ? `${c.max_days} days or less before arrival: ${c.pct}% of the total`
                : `${c.min_days} to ${c.max_days} days before arrival: ${c.pct}% of the total`
          ),
  };
}

// Apply what the sales member edited on the Final draft step.
export function withEdits(def: DraftSections, draft?: PlanDraft): DraftSections {
  if (!draft) return def;
  return {
    ...def,
    title: draft.title?.trim() || def.title,
    routeLine: draft.subtitle?.trim() || def.routeLine,
    about: draft.about !== undefined ? draft.about : def.about,
    inclusions: draft.inclusions ?? def.inclusions,
    exclusions: draft.exclusions ?? def.exclusions,
    notes: draft.notes ?? def.notes,
  };
}
