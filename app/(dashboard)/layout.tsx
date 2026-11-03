import { requireUser, type Role } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { sopStatus } from "@/lib/sop/server";
import { showReadBanner } from "@/lib/sop/access";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireUser();
  const role = (profile?.role ?? "lodge_manager") as Role;
  const name = profile?.full_name ?? "User";
  // SOP tab and "please read" banner (no access, or SQL not run yet = nothing changes)
  const sop = await sopStatus();

  return (
    <AppShell role={role} name={name} sopAccess={sop.canView} sopUnread={showReadBanner(sop) ? sop.version : null}>
      {children}
    </AppShell>
  );
}
