import { requireUser, type Role } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireUser();
  const role = (profile?.role ?? "resort_manager") as Role;
  const name = profile?.full_name ?? "User";

  return (
    <div className="flex min-h-screen">
      <Sidebar role={role} name={name} />
      <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
