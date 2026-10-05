import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { ComingSoon } from "@/components/sales/coming-soon";

export default async function SalesAdminPage() {
  const { profile } = await requireUser();
  if (!isSuperAdmin(profile?.role)) redirect("/sales");
  return (
    <ComingSoon title="Master data">
      Parks, lodges, rooms, rates, transfers, offers and content are the next step.
    </ComingSoon>
  );
}
