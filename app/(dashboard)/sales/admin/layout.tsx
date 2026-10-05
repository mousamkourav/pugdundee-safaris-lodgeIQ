import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";

// Master data is for super roles only. Server actions re-check this too.
export default async function SalesAdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  if (!isSuperAdmin(profile?.role)) redirect("/sales");
  return <>{children}</>;
}
