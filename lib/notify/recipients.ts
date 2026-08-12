import { createAdminClient } from "@/lib/supabase/admin";

export type Recipient = { id: string; email: string };

// Who should receive alerts for a lodge:
//  - all super admins and general managers
//  - resort managers assigned to that specific lodge
export async function recipientsForLodge(lodgeId: string): Promise<Recipient[]> {
  const admin = createAdminClient();

  const [usersRes, profilesRes, accessRes] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("profiles").select("id,role,status"),
    admin.from("user_lodge_access").select("user_id,lodge_id"),
  ]);

  const emailById = new Map<string, string>();
  for (const u of usersRes.data?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const access = (accessRes.data ?? []) as Array<{
    user_id: string;
    lodge_id: string;
  }>;
  const assigned = new Set(
    access.filter((a) => a.lodge_id === lodgeId).map((a) => a.user_id)
  );

  const out: Recipient[] = [];
  for (const p of (profilesRes.data ?? []) as Array<{
    id: string;
    role: string;
    status: string;
  }>) {
    if (p.status !== "active") continue;
    const email = emailById.get(p.id);
    if (!email) continue;
    const isAdmin = p.role === "super_admin" || p.role === "general_manager";
    const isLodgeMgr = p.role === "resort_manager" && assigned.has(p.id);
    if (isAdmin || isLodgeMgr) out.push({ id: p.id, email });
  }
  return out;
}
