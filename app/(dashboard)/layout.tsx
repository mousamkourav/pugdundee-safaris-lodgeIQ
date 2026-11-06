import { requireUser, type Role } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { sopStatus } from "@/lib/sop/server";
import { showReadBanner } from "@/lib/sop/access";
import { rpStatus } from "@/lib/redpanda/server";
import { groupStatus } from "@/lib/sales/group/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireUser();
  const role = (profile?.role ?? "lodge_manager") as Role;
  const name = profile?.full_name ?? "User";
  // SOP tab and "please read" banner (no access, or SQL not run yet = nothing changes)
  const [sop, rp, grp] = await Promise.all([sopStatus(), rpStatus(profile?.role), groupStatus(profile?.role)]);

  return (
    <AppShell role={role} name={name} sopAccess={sop.canView} sopUnread={showReadBanner(sop) ? sop.readVersion : null} rpAccess={rp.canUse} groupAccess={grp.canUse}>
      {children}
    </AppShell>
  );
}
