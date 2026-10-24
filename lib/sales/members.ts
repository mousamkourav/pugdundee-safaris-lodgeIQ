// Server-only: imports the service-role client. Never import from a "use client" file.
import { createAdminClient } from "@/lib/supabase/admin";

// Display names for sales members. Uses the service-role client because
// profiles RLS may not let one user read another's name (same pattern as
// Trip Reports). Call only after the page has checked permissions.
export async function getMemberNames(extraIds: string[] = []) {
  const admin = createAdminClient();
  const ids = Array.from(new Set(extraIds.filter(Boolean)));

  // The Sales team, plus anyone who has created or been given a query (a super admin
  // making itineraries too), so filters list everyone who has work in Sales.
  const [{ data: team }, { data: owners }] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, status").in("role", ["sales_member", "sales_admin"]),
    admin.from("sales_queries").select("assigned_to, created_by").limit(5000),
  ]);
  const ownerIds = [...new Set(((owners ?? []) as { assigned_to: string | null; created_by: string | null }[]).flatMap((q) => [q.assigned_to, q.created_by]).filter((x): x is string => !!x))];
  const teamIds = new Set((team ?? []).map((m) => m.id as string));
  const extraOwners = ownerIds.filter((id) => !teamIds.has(id));
  const { data: ownerProfiles } = extraOwners.length
    ? await admin.from("profiles").select("id, full_name, role, status").in("id", extraOwners)
    : { data: [] as { id: string; full_name: string | null; role: string; status: string | null }[] };
  const members = [...(team ?? []), ...(ownerProfiles ?? [])];

  const known = new Set((members ?? []).map((m) => m.id as string));
  const missing = ids.filter((id) => !known.has(id));
  const { data: others } = missing.length
    ? await admin.from("profiles").select("id, full_name, role, status").in("id", missing)
    : { data: [] as { id: string; full_name: string | null; role: string; status: string | null }[] };

  const all = [...(members ?? []), ...(others ?? [])] as {
    id: string;
    full_name: string | null;
    role: string;
    status: string | null;
  }[];

  const names: Record<string, string> = {};
  for (const p of all) names[p.id] = p.full_name || "Unnamed";
  return { names, members: (members ?? []) as typeof all };
}
