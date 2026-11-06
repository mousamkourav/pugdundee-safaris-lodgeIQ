import type { Role } from "@/lib/auth";

// Each nav group belongs to one module. The shell shows only the groups of the
// module the current page is in, so Lodge Reporting and Sales each get a clean
// sidebar. To add a future module: add it to Module, give its groups that
// module, and teach moduleForPath() its URL prefix.
export type Module = "reporting" | "sales" | "sop" | "redpanda";

export interface NavItem {
  label: string;
  href: string;
  icon: string; // key into components/icons.tsx
  roles?: Role[];
  exact?: boolean; // active only on this exact path (for section index pages)
  needs?: "group"; // shown only with group quote access (the layout decides; lib/sales/group/server.ts)
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
// SOP: only the super admin edits (lib/sop/access.ts).
const SOP_EDITOR: Role[] = ["super_admin"];

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
      // tour operators' groups (6 + 1 tour leader...): for people given access (by person or role)
      { label: "Group quotes", href: "/sales/groups", icon: "users", exact: true, needs: "group" },
      { label: "Create group quote", href: "/sales/groups/new", icon: "plus", needs: "group" },
      { label: "Group access", href: "/sales/groups/access", icon: "shield", needs: "group", roles: ["super_admin"] },
      // every Sales user; a member sees only their own bookings (row level security)
      { label: "Payments", href: "/sales/payments", icon: "receipt" },
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

  // ---------------- SOP ----------------
  // Shown only to people with SOP access (the layout decides; see modulesFor). The super admin
  // edits, imports and exports on the SOP page itself.
  // ---------------- Red Panda ----------------
  // Shown only to Sales users given Red Panda access (the layout decides; see modulesFor). Master
  // data and access: the super admin.
  {
    title: "Red Panda",
    module: "redpanda",
    items: [
      { label: "Quotes", href: "/red-panda", icon: "list", exact: true },
      { label: "New quote", href: "/red-panda/new", icon: "plus" },
      { label: "Master data", href: "/red-panda/master", icon: "building", roles: SOP_EDITOR },
      { label: "Access", href: "/red-panda/access", icon: "shield", roles: SOP_EDITOR },
    ],
  },
  {
    title: "SOP",
    module: "sop",
    items: [
      { label: "SOP", href: "/sop", icon: "fileText", exact: true },
      { label: "Access & reading", href: "/sop/access", icon: "shield", roles: SOP_EDITOR },
    ],
  },
];

export function moduleForPath(pathname: string, role: Role): Module {
  if (pathname === "/sop" || pathname.startsWith("/sop/")) return "sop";
  if (pathname === "/red-panda" || pathname.startsWith("/red-panda/")) return "redpanda";
  if (role === "sales_member" || role === "sales_admin") return "sales";
  return pathname === "/sales" || pathname.startsWith("/sales/") ? "sales" : "reporting";
}

export const MODULES: { key: Module; label: string; href: string }[] = [
  { key: "reporting", label: "Lodge Reporting", href: "/dashboard" },
  { key: "sales", label: "Sales & Itinerary", href: "/sales" },
  { key: "sop", label: "SOP", href: "/sop" },
];

// Only super roles can switch modules. Duplicated role list, see SUPER above.
export const canSwitchModules = (role: Role) => SUPER.includes(role);

// The tabs of the module switcher. Super roles: Lodge Reporting and Sales, plus SOP when they
// may read it. Anyone else given SOP access: their own module and SOP. Without SOP access the
// tabs are what they always were (none for those who cannot switch).
// Red Panda (a fourth tab, for Sales users given access; lib/redpanda/access.ts) comes last.
export const RED_PANDA_MODULE = { key: "redpanda" as const, label: "Red Panda", href: "/red-panda" };
export function modulesFor(role: Role, sopAccess: boolean, rpAccess = false): { key: Module; label: string; href: string }[] {
  const sop = MODULES.filter((m) => m.key === "sop");
  const rp = rpAccess ? [RED_PANDA_MODULE] : [];
  if (canSwitchModules(role)) return [...MODULES.filter((m) => m.key !== "sop"), ...(sopAccess ? sop : []), ...rp];
  if (!sopAccess && !rpAccess) return [];
  const own =
    role === "sales_member" || role === "sales_admin"
      ? { key: "sales" as const, label: "Sales & Itinerary", href: "/sales" }
      : role === "task_creator"
        ? { key: "reporting" as const, label: "Trip reports", href: "/trip-reports" }
        : { key: "reporting" as const, label: "Lodge Reporting", href: "/dashboard" };
  return [own, ...(sopAccess ? sop : []), ...rp];
}
