// Small rules for the items of a day on Plan & price, kept here so they are tested.
import { sameCity } from "./cities";
import type { PlanDay, PlanItem } from "./types";
import type { Addon } from "@/lib/sales/pricing/types";

// A flight on a day that already has one from the same airport or to the same city (Jorhat - Delhi
// added where Guwahati - Delhi was planned) takes its place: one way home, never two flights
// charged (Manav, 4 Nov 2026). Anything else is added at the end of the day.
export function withItem(day: PlanDay, item: PlanItem): PlanDay {
  const items = day.items ?? [];
  const f = item.type === "flight" ? item.flight : undefined;
  const same = f ? items.findIndex((x) => x.type === "flight" && !!x.flight && (sameCity(x.flight.to, f.to) || sameCity(x.flight.from, f.from))) : -1;
  if (same >= 0) return { ...day, items: items.map((x, k) => (k === same ? item : x)) };
  return { ...day, items: [...items, item] };
}

// The price one add-on is charged at for this group, as the costing takes it: a per-group price by
// group size (Denwa boat safari: 2 / 4 / 6 guests) for the guests counted (children 5 and over),
// else the foreign or Indian rate. `groupOf` is set when the price is for a group of that size.
export function addonBasePrice(a: Addon, guest: { adults: number; children: number[]; nationality: string }): { rate: number; groupOf: number | null } {
  const foreign = guest.nationality === "foreign";
  const guests = guest.adults + guest.children.filter((x) => x >= 5).length;
  const tiers = a.pricing_unit === "per_group" ? (foreign ? a.tiers_foreign ?? a.tiers : a.tiers) ?? null : null;
  const tier = tiers?.length ? tiers.find((t) => guests <= t.max_guests) ?? tiers[tiers.length - 1] : null;
  if (tier) return { rate: tier.rate, groupOf: guests };
  return { rate: foreign && a.rate_foreign != null ? a.rate_foreign : a.rate, groupOf: null };
}
