import type { Role } from "@/lib/auth";

export interface NavItem {
  label: string;
  href: string;
  roles?: Role[]; // if set, only these roles see the item
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard" }],
  },
  {
    title: "Operations",
    items: [{ label: "Lodges", href: "/lodges" }],
  },
  {
    title: "Admin",
    items: [
      {
        label: "Users & access",
        href: "/admin/users",
        roles: ["super_admin", "general_manager"],
      },
    ],
  },
];
