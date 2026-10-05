import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role =
  | "super_admin"
  | "senior_manager"
  | "delhi_accounts"
  | "lodge_manager"
  | "operations_manager"
  | "lodge_accounts"
  | "sales_member";

// Human-readable labels for each role (used in the users admin dropdown).
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  senior_manager: "Senior manager",
  delhi_accounts: "Delhi accounts",
  lodge_manager: "Lodge manager",
  operations_manager: "Operations manager",
  lodge_accounts: "Lodge accounts",
  sales_member: "Sales member",
};

// Roles that can see ALL lodges.
export const ADMIN_ROLES: Role[] = ["super_admin", "senior_manager", "delhi_accounts"];
// Roles with full control (manage users, delete).
export const SUPER_ROLES: Role[] = ["super_admin", "senior_manager"];
// Roles that can use the Sales & Itinerary module. Super roles act as sales
// admins (rates, members, all queries); sales_member sees only their own queries.
export const SALES_ROLES: Role[] = ["super_admin", "senior_manager", "sales_member"];

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

export const isSalesUser = (role?: string | null) =>
  role === "sales_member" || isSuperAdmin(role);

// A sales member never sees Lodge Reporting.
export const isSalesOnly = (role?: string | null) => role === "sales_member";

// Where a user lands after sign-in.
//   super roles -> module picker; sales members -> Sales; everyone else -> Lodge Reporting.
export function homePathFor(role?: string | null) {
  if (isSalesOnly(role)) return "/sales";
  if (isSuperAdmin(role)) return "/hub";
  return "/dashboard";
}
