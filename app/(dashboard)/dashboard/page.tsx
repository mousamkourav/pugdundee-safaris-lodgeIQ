import { createClient } from "@/lib/supabase/server";
import { requireUser, isAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";

export default async function DashboardPage() {
  const { profile } = await requireUser();
  const supabase = await createClient();

  const { count: lodgeCount } = await supabase
    .from("lodges")
    .select("*", { count: "exact", head: true });

  let userCount: number | null = null;
  if (isAdmin(profile?.role)) {
    const r = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });
    userCount = r.count ?? 0;
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${profile?.full_name ?? ""}`.trim()}
        description="Here's your operations overview."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Lodges" value={lodgeCount ?? 0} />
        {userCount !== null && <KpiCard label="Users" value={userCount} />}
        <KpiCard
          label="Your role"
          value={(profile?.role ?? "").replace("_", " ")}
        />
      </div>
      <p className="mt-8 text-sm text-sand-500">
        More modules — occupancy, expenses, staff &amp; payroll, bar, stock,
        reports — arrive in the next milestones.
      </p>
    </div>
  );
}
