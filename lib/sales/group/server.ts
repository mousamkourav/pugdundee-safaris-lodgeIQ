// Group quotes: who may make them (server side). The database decides (sales_group_can_use: the
// super admin, or access given by person or role); only Sales users. Every group page calls
// requireGroupUser(); every group server action groupActor() / groupEditor(); RLS checks again.
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, homePathFor, isSalesUser, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface GroupAccess {
  canUse: boolean;
  isEditor: boolean;
}
const NONE: GroupAccess = { canUse: false, isEditor: false };

// One call per request; SQL not run yet (no function) or any failure = no access (nothing shows).
export const groupStatus = cache(async (role: string | null | undefined): Promise<GroupAccess> => {
  if (!isSalesUser(role)) return NONE;
  try {
    const supabase = await createClient();
    const [u, e] = await Promise.all([supabase.rpc("sales_group_can_use"), supabase.rpc("sales_group_is_editor")]);
    if (u.error) return NONE;
    return { canUse: u.data === true, isEditor: e.data === true && role === "super_admin" };
  } catch {
    return NONE;
  }
});

export async function requireGroupUser() {
  const r = await requireUser();
  const access = await groupStatus(r.profile?.role);
  if (!access.canUse) redirect(homePathFor(r.profile?.role));
  return { ...r, access };
}

export async function groupActor(): Promise<{ error: string } | { userId: string; access: GroupAccess }> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };
  const access = await groupStatus(cu.profile?.role);
  if (!access.canUse) return { error: "You do not have access to group quotes." };
  return { userId: cu.user.id, access };
}
