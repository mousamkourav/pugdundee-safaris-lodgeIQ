import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  href: string;
  icon: string; // key into components/icons.tsx
  roles?: Role[];
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

const ADMIN: Role[] = ["super_admin", "senior_manager", "delhi_accounts"];

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "grid" },
      { label: "Notifications", href: "/notifications", icon: "bell" },
    ],
  },
  {
    title: "Reporting",
    items: [
      { label: "Enter monthly report", href: "/monthly", icon: "clipboard" },
      { label: "Monthly summary", href: "/reports", icon: "fileText" },
      { label: "Detailed report", href: "/report-detail", icon: "fileSearch" },
      { label: "Compare lodges", href: "/analytics", icon: "barChart", roles: ADMIN },
    ],
  },
  {
    title: "Operations",
    items: [
      // Admin + managers = every role today, so no roles filter is needed.
      // Add roles here if a new role should not see trip reports.
      { label: "Trip reports", href: "/trip-reports", icon: "route" },
    ],
  },
  {
    title: "Assets & compliance",
    items: [
      { label: "Assets & service log", href: "/assets", icon: "wrench" },
      { label: "Insurances & licences", href: "/compliance", icon: "shield" },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Lodges", href: "/lodges", icon: "building", roles: ADMIN },
      { label: "Users & access", href: "/admin/users", icon: "userCog", roles: ADMIN },
    ],
  },
];
