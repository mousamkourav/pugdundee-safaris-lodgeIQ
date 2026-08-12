import { createClient } from "@/lib/supabase/server";

export type LodgeLite = { id: string; name: string };

// RLS ensures a resort manager only sees their lodges; admins see all.
export async function getAccessibleLodges(): Promise<LodgeLite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lodges")
    .select("id,name")
    .eq("status", "active")
    .order("name");
  return ((data as LodgeLite[] | null) ?? []);
}

export function resolveLodge(
  selected: string | undefined,
  lodges: LodgeLite[]
): string | null {
  if (selected && lodges.some((l) => l.id === selected)) return selected;
  return lodges[0]?.id ?? null;
}
