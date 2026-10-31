// Meal plans as the pricing engine compares them: EP, CP, MAP, AP. A rate saved as
// "B&B", "BB" or "Bed & breakfast" is CP; "FB" / "Full board" is AP; "HB" / "Half board"
// is MAP; "RO" / "Room only" is EP. Anything else is kept as it is (upper case).
const ALIASES: [RegExp, string][] = [
  [/^(ep|ro|room\s*only|european(\s*plan)?)$/, "EP"],
  [/^(cp|b\s*&\s*b|bb|b\s*and\s*b|bed\s*(&|and)\s*breakfast|with\s*breakfast|continental(\s*plan)?)$/, "CP"],
  [/^(map|hb|half\s*board|modified\s*american(\s*plan)?)$/, "MAP"],
  [/^(ap|fb|full\s*board|american(\s*plan)?|all\s*meals)$/, "AP"],
];

export function mealCode(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "";
  for (const [re, code] of ALIASES) if (re.test(s)) return code;
  return s.toUpperCase();
}
