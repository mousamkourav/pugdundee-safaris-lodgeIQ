import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role =
  | "super_admin"
  | "senior_manager"
  | "delhi_accounts"
  | "lodge_manager"
  | "operations_manager"
  | "lodge_accounts"
  | "sales_member"
  | "sales_admin"
  | "task_creator";

// Human-readable labels for each role (used in the users admin dropdown).
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  senior_manager: "Senior manager",
  delhi_accounts: "Delhi accounts",
  lodge_manager: "Lodge manager",
  operations_manager: "Operations manager",
  lodge_accounts: "Lodge accounts",
  sales_member: "Sales member",
  sales_admin: "Sales admin",
  task_creator: "Task creator",
};

// Roles that can see ALL lodges.
export const ADMIN_ROLES: Role[] = ["super_admin", "senior_manager", "delhi_accounts"];
// Roles with full control (manage users, delete).
export const SUPER_ROLES: Role[] = ["super_admin", "senior_manager"];
// Roles that can use the Sales & Itinerary module. Super roles act as sales
// admins (rates, members, all queries); sales_member sees only their own queries.
export const SALES_ROLES: Role[] = ["super_admin", "senior_manager", "sales_member", "sales_admin"];

// A deactivated account ("disabled") is turned away everywhere, not only at
// sign-in: someone already signed in when an admin deactivates them loses access
// on their next click. No profile row (a read failure) is not treated as deactivated.
export const isInactive = (profile?: { status?: string | null } | null) => !!profile?.status && profile.status !== "active";

// cache(): the dashboard layout and the page both call this during one request;
// dedupe so the Auth + profile round-trips to Supabase happen once, not twice.
const loadUser = cache(async function loadUser() {
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
});

// The signed-in, ACTIVE user, or null. Server actions and API routes call this,
// so a deactivated account gets their usual "no access" answer.
export async function getCurrentUser() {
  const res = await loadUser();
  if (!res || isInactive(res.profile)) return null;
  return res;
}

// Pages: not signed in -> /login; deactivated -> the "Account deactivated" page.
export async function requireUser() {
  const res = await loadUser();
  if (!res?.user) redirect("/login");
  if (isInactive(res.profile)) redirect("/account-inactive");
  return res;
}

export const isAdmin = (role?: string | null) =>
  role === "super_admin" || role === "senior_manager" || role === "delhi_accounts";

export const isSuperAdmin = (role?: string | null) =>
  role === "super_admin" || role === "senior_manager";

export const isSalesUser = (role?: string | null) =>
  role === "sales_member" || role === "sales_admin" || isSuperAdmin(role);

// A sales member never sees Lodge Reporting.
export const isSalesOnly = (role?: string | null) => role === "sales_member" || role === "sales_admin";
export const isTaskCreatorOnly = (role?: string | null) => role === "task_creator";

// Where a user lands after sign-in.
//   super roles -> module picker; sales members -> Sales; task creators -> Trip
//   reports (the only page they use); everyone else -> Lodge Reporting.
export function homePathFor(role?: string | null) {
  if (isSalesOnly(role)) return "/sales";
  if (isTaskCreatorOnly(role)) return "/trip-reports";
  if (isSuperAdmin(role)) return "/hub";
  return "/dashboard";
}

// Full authority inside Sales (queries, master data, members). Super roles
// have it too; a sales_admin has it WITHOUT any Lodge Reporting access.
export const isSalesAdmin = (role?: string | null) => role === "sales_admin" || isSuperAdmin(role);
