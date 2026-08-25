import { createClient } from "@/lib/supabase/server";
import { lodgeSlug } from "@/lib/lodge-slug";

export { lodgeSlug };
export type LodgeLite = { id: string; name: string };

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
  if (selected) {
    const byId = lodges.find((l) => l.id === selected);
    if (byId) return byId.id;
    const bySlug = lodges.find((l) => lodgeSlug(l.name) === selected);
    if (bySlug) return bySlug.id;
  }
  return lodges[0]?.id ?? null;
}
