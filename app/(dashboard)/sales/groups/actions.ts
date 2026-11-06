"use server";

// Group quotes: access by person or role (the super admin gives and removes it). Each action checks
// the caller first (guard); RLS on sales_group_access checks again; a trigger writes the audit.
import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safe } from "@/lib/sales/safe";
import { GROUP_GRANTABLE_ROLES } from "@/lib/sales/group/access";


async function guard(): Promise<{ error: string } | { userId: string }> {
  const cu = await getCurrentUser();
  if (!cu?.user || cu.profile?.role !== "super_admin") return { error: "Only the super admin gives access to group quotes." };
  return { userId: cu.user.id };
}

export async function grantGroupAccess(kind: "user" | "role", value: string): Promise<{ ok?: true; error?: string }> {
  return safe("group grant", async () => {
    const g = await guard();
    if ("error" in g) return g;
    const supabase = await createClient();
    if (kind === "role") {
      if (!(GROUP_GRANTABLE_ROLES as readonly string[]).includes(value)) return { error: "Group quotes are for Sales roles." };
      const { error } = await supabase.from("sales_group_access").insert({ role: value });
      if (error && !/duplicate/i.test(error.message)) return { error: error.message };
    } else {
      if (!/^[0-9a-f-]{36}$/i.test(value)) return { error: "Choose a person." };
      const { data: p } = await createAdminClient().from("profiles").select("role").eq("id", value).maybeSingle();
      if (!isSalesUser((p as { role?: string } | null)?.role)) return { error: "Group quotes are Sales queries: give access to Sales users only." };
      const { error } = await supabase.from("sales_group_access").insert({ user_id: value });
      if (error && !/duplicate/i.test(error.message)) return { error: error.message };
    }
    revalidatePath("/sales/groups/access");
    return { ok: true };
  });
}

export async function revokeGroupAccess(id: string): Promise<{ ok?: true; error?: string }> {
  return safe("group revoke", async () => {
    const g = await guard();
    if ("error" in g) return g;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown access row." };
    const { error } = await (await createClient()).from("sales_group_access").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/sales/groups/access");
    return { ok: true };
  });
}
