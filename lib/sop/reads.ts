// "Who has read version N": the people, their role and lodges, and when they said "I have read".
// Server only (used by the Who has read page and its Excel export, super admin).
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { readReport, type AccessRow, type Person, type ReadRow } from "./access";

export async function loadReadReport(documentId: string, versionId: string): Promise<ReadRow[]> {
  const supabase = await createClient();
  const [people, access, reads, lodgeAccess, lodges] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role, status"),
    supabase.from("sop_access").select("id, user_id, role").eq("document_id", documentId),
    supabase.from("sop_reads").select("user_id, read_at").eq("version_id", versionId),
    supabase.from("user_lodge_access").select("user_id, lodge_id"),
    supabase.from("lodges").select("id, name"),
  ]);
  const lodgeName = new Map(((lodges.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name]));
  const byUser = new Map<string, string[]>();
  for (const r of (lodgeAccess.data ?? []) as { user_id: string; lodge_id: string }[]) {
    const n = lodgeName.get(r.lodge_id);
    if (n) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), n].sort());
  }
  return readReport(
    (people.data ?? []) as Person[],
    (access.data ?? []) as AccessRow[],
    (reads.data ?? []) as { user_id: string; read_at: string }[],
    (id) => byUser.get(id) ?? [],
    (role) => ROLE_LABELS[role as Role] ?? role
  );
}
