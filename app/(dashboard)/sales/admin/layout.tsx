import { redirect } from "next/navigation";
import { requireUser, isSalesAdmin } from "@/lib/auth";

// Master data is for super roles only. Server actions re-check this too.
export default async function SalesAdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  if (!isSalesAdmin(profile?.role)) redirect("/sales");
  return <>{children}</>;
}
