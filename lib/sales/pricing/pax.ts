// The price per guest in words: "per adult", "per extra adult", "child, 8 yrs", "infant, 2 yrs".
// Shared by the builder, the guest page, the query page and the trip assistant.
import type { PaxSplit } from "./types";

export function paxLines(perPerson: number, split: PaxSplit | undefined, fmt: (n: number) => string): { label: string; amount: string }[] {
  if (!split || (!split.children.length && !split.extra_adults)) return [{ label: "per person", amount: fmt(perPerson) }];
  const out = [{ label: split.extra_adults ? "per adult, twin sharing" : "per adult", amount: fmt(split.adult) }];
  if (split.extra_adult !== null) out.push({ label: `per extra adult (extra bed)${split.extra_adults > 1 ? `, x${split.extra_adults}` : ""}`, amount: fmt(split.extra_adult) });
  for (const c of split.children) out.push({ label: `${c.infant ? "infant" : "child"}, ${c.age} yr${c.age === 1 ? "" : "s"}`, amount: c.amount ? fmt(c.amount) : "no charge" });
  return out;
}

export const paxText = (perPerson: number, split: PaxSplit | undefined, fmt: (n: number) => string) =>
  paxLines(perPerson, split, fmt)
    .map((l) => `${l.amount} ${l.label}`)
    .join(" \u00b7 ");

// The same split in another currency (the guest page converts every amount).
export const convertSplit = (s: PaxSplit | undefined, conv: (n: number) => number): PaxSplit | undefined =>
  s && { ...s, adult: conv(s.adult), extra_adult: s.extra_adult === null ? null : conv(s.extra_adult), children: s.children.map((c) => ({ ...c, amount: conv(c.amount) })) };
