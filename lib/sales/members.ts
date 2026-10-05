// Server-only: imports the service-role client. Never import from a "use client" file.
import { createAdminClient } from "@/lib/supabase/admin";

// Display names for sales members. Uses the service-role client because
// profiles RLS may not let one user read another's name (same pattern as
// Trip Reports). Call only after the page has checked permissions.
export async function getMemberNames(extraIds: string[] = []) {
  const admin = createAdminClient();
  const ids = Array.from(new Set(extraIds.filter(Boolean)));

  const { data: members } = await admin
    .from("profiles")
    .select("id, full_name, role, status")
    .eq("role", "sales_member");

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
