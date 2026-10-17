import type { Role } from "@/lib/auth";

// Each nav group belongs to one module. The shell shows only the groups of the
// module the current page is in, so Lodge Reporting and Sales each get a clean
// sidebar. To add a future module: add it to Module, give its groups that
// module, and teach moduleForPath() its URL prefix.
export type Module = "reporting" | "sales";

export interface NavItem {
  label: string;
  href: string;
  icon: string; // key into components/icons.tsx
  roles?: Role[];
  exact?: boolean; // active only on this exact path (for section index pages)
}
export interface NavGroup {
  title: string;
  module: Module;
  items: NavItem[];
}

const ADMIN: Role[] = ["super_admin", "senior_manager", "delhi_accounts"];
// Duplicated from lib/auth.ts (server-only file; nav.ts is imported by a client component).
const SUPER: Role[] = ["super_admin", "senior_manager"];
// Sales admin features: super roles plus the Sales-only admin.
const SALES_ADMIN: Role[] = ["super_admin", "senior_manager", "sales_admin"];

export const NAV: NavGroup[] = [
  // ---------------- Lodge Reporting ----------------
  {
    title: "Overview",
    module: "reporting",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "grid", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
      { label: "Notifications", href: "/notifications", icon: "bell", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
    ],
  },
  {
    title: "Reporting",
    module: "reporting",
    items: [
      { label: "Enter monthly report", href: "/monthly", icon: "clipboard", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
      { label: "Monthly summary", href: "/reports", icon: "fileText", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
      { label: "Detailed report", href: "/report-detail", icon: "fileSearch", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
      { label: "Compare lodges", href: "/analytics", icon: "barChart", roles: ADMIN },
    ],
  },
  {
    title: "Operations",
    module: "reporting",
    items: [
      // Admin + managers = every reporting role today, so no roles filter is needed.
      { label: "Trip reports", href: "/trip-reports", icon: "route" },
    ],
  },
  {
    title: "Assets & compliance",
    module: "reporting",
    items: [
      { label: "Assets & service log", href: "/assets", icon: "wrench", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
      { label: "Insurances & licences", href: "/compliance", icon: "shield", roles: ["super_admin", "senior_manager", "delhi_accounts", "lodge_manager", "operations_manager", "lodge_accounts"] },
    ],
  },
  {
    title: "Admin",
    module: "reporting",
    items: [
      { label: "Lodges", href: "/lodges", icon: "building", roles: ADMIN },
      { label: "Users & access", href: "/admin/users", icon: "userCog", roles: ADMIN },
    ],
  },

  // ---------------- Sales & Itinerary ----------------
  {
    title: "Sales",
    module: "sales",
    items: [
      { label: "Dashboard", href: "/sales", icon: "grid", exact: true },
      { label: "Create itinerary", href: "/sales/new", icon: "plus" },
      { label: "Queries", href: "/sales/queries", icon: "list" },
      { label: "Lost & cancelled", href: "/sales/closed", icon: "xCircle" },
    ],
  },
  {
    title: "Sales admin",
    module: "sales",
    items: [
      { label: "Master data", href: "/sales/admin", icon: "building", roles: SALES_ADMIN },
      { label: "Members", href: "/sales/members", icon: "users", roles: SALES_ADMIN },
    ],
  },
];

export function moduleForPath(pathname: string, role: Role): Module {
  if (role === "sales_member" || role === "sales_admin") return "sales";
  return pathname === "/sales" || pathname.startsWith("/sales/") ? "sales" : "reporting";
}

export const MODULES: { key: Module; label: string; href: string }[] = [
  { key: "reporting", label: "Lodge Reporting", href: "/dashboard" },
  { key: "sales", label: "Sales & Itinerary", href: "/sales" },
];

// Only super roles can switch modules. Duplicated role list, see SUPER above.
export const canSwitchModules = (role: Role) => SUPER.includes(role);
