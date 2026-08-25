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

const ADMIN: Role[] = ["super_admin", "general_manager"];

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "grid" },
      { label: "Notifications", href: "/notifications", icon: "bell" },
    ],
  },
  {
    title: "Monthly reporting",
    items: [
      { label: "Enter monthly report", href: "/monthly", icon: "clipboard" },
      { label: "Monthly summary", href: "/reports", icon: "fileText" },
      { label: "Detailed report", href: "/report-detail", icon: "clipboard" },
      { label: "Compare lodges", href: "/analytics", icon: "barChart", roles: ADMIN },
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
      { label: "Lodges", href: "/lodges", icon: "building" },
      { label: "Users & access", href: "/admin/users", icon: "userCog", roles: ADMIN },
    ],
  },
];
