import { requireUser, type Role } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireUser();
  const role = (profile?.role ?? "lodge_manager") as Role;
  const name = profile?.full_name ?? "User";

  return (
    <AppShell role={role} name={name}>
      {children}
    </AppShell>
  );
}
