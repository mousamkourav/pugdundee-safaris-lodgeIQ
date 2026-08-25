import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role =
  | "super_admin"
  | "senior_manager"
  | "delhi_accounts"
  | "lodge_manager"
  | "operations_manager"
  | "lodge_accounts";

// Human-readable labels for each role (used in the users admin dropdown).
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  senior_manager: "Senior manager",
  delhi_accounts: "Delhi accounts",
  lodge_manager: "Lodge manager",
  operations_manager: "Operations manager",
  lodge_accounts: "Lodge accounts",
};

// Roles that can see ALL lodges.
export const ADMIN_ROLES: Role[] = ["super_admin", "senior_manager", "delhi_accounts"];
// Roles with full control (manage users, delete).
export const SUPER_ROLES: Role[] = ["super_admin", "senior_manager"];

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return { user, profile };
}

export async function requireUser() {
  const res = await getCurrentUser();
  if (!res?.user) redirect("/login");
  return res;
}

export const isAdmin = (role?: string | null) =>
  role === "super_admin" || role === "senior_manager" || role === "delhi_accounts";

export const isSuperAdmin = (role?: string | null) =>
  role === "super_admin" || role === "senior_manager";
