// The guest-facing sections of an itinerary (title, intro, inclusions,
// exclusions, notes, terms). Shared by the builder's Final draft step and the
// public client page, so both always show the same text.
import type { CancellationSlab, ContentBlock, Plan, PlanDraft } from "./types";

export interface DraftSections {
  title: string;
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

const MEALS: Record<string, string> = { AP: "all meals", MAP: "breakfast and dinner", CP: "breakfast", EP: "room only" };

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

  const inclusions = textsFor("inclusions").flatMap(lines);
  const exclusions = textsFor("exclusions").flatMap(lines);
  const cancellation = textsFor("cancellation_terms").flatMap(lines);

  return {
    title: parks.length ? `${parks.join(" & ")} Safari` : "Your safari",
    about:
      textsFor("about_trip")[0] ??
      (nights
        ? `A ${nights}-night journey through ${parks.join(", ")}, staying at ${lodges.join(" and ")}, with resident naturalists on every safari.`
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
    notes: textsFor("important_notes").flatMap(lines),
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
    about: draft.about !== undefined ? draft.about : def.about,
    inclusions: draft.inclusions ?? def.inclusions,
    exclusions: draft.exclusions ?? def.exclusions,
    notes: draft.notes ?? def.notes,
  };
}
