// Column groups for the comparison tables. Client-safe (no server imports).
// The dashboard and Compare-lodges pages read these to show/hide column sets,
// so the default view is lean and users opt into more detail.

export type ColGroupKey =
  | "core"
  | "sales"
  | "expenses"
  | "perroom"
  | "ops";

export type ColGroup = {
  key: ColGroupKey;
  label: string;
  // whether this group is shown by default (lean default = less clutter)
  on: boolean;
  // always-on groups can't be turned off
  locked?: boolean;
};

export const COL_GROUPS: ColGroup[] = [
  { key: "core", label: "Core", on: true, locked: true }, // lodge, room nights, pax
  { key: "sales", label: "Sales", on: true },
  { key: "expenses", label: "Expenses", on: true },
  { key: "perroom", label: "Per-room", on: false },
  { key: "ops", label: "Operations", on: false }, // energy, safaris, rating
];

// Parse the ?cols= param (comma-separated keys). If absent, use defaults.
export function activeGroups(param: string | undefined): Set<ColGroupKey> {
  if (!param) {
    return new Set(
      COL_GROUPS.filter((g) => g.on).map((g) => g.key)
    );
  }
  const chosen = new Set(
    param.split(",").filter(Boolean) as ColGroupKey[]
  );
  // core is always on
  chosen.add("core");
  return chosen;
}
