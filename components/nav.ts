import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  href: string;
  roles?: Role[];
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Notifications", href: "/notifications" },
    ],
  },
  {
    title: "Monthly reporting",
    items: [
      { label: "Enter monthly report", href: "/monthly" },
      {
        label: "Compare lodges",
        href: "/analytics",
        roles: ["super_admin", "general_manager"],
      },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Lodges", href: "/lodges" },
      {
        label: "Users & access",
        href: "/admin/users",
        roles: ["super_admin", "general_manager"],
      },
    ],
  },
];
