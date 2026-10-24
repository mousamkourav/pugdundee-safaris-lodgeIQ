import { redirect } from "next/navigation";
import { requireUser, isSalesAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MembersManager, type MemberRow } from "@/components/sales/members-manager";

// The Sales team: Sales members and Sales admins only. Lodge users stay in
// Users & access. Read with the service role after the permission check.
export default async function SalesMembersPage() {
  const { user, profile } = await requireUser();
  if (!isSalesAdmin(profile?.role)) redirect("/sales");

  const admin = createAdminClient();
  const [{ data: profiles }, { data: usersPage }, { data: queries }] = await Promise.all([
    admin.from("profiles").select("id, full_name, role, status, phone, extra").in("role", ["sales_member", "sales_admin", "super_admin", "senior_manager"]),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("sales_queries").select("assigned_to, status").is("deleted_at", null),
  ]);

  const authById = new Map((usersPage?.users ?? []).map((u) => [u.id, u]));
  const counts = new Map<string, { total: number; open: number; booked: number; draft: number }>();
  for (const q of (queries ?? []) as { assigned_to: string | null; status: string }[]) {
    if (!q.assigned_to) continue;
    const c = counts.get(q.assigned_to) ?? { total: 0, open: 0, booked: 0, draft: 0 };
    if (q.status === "draft") c.draft += 1;
    else c.total += 1;
    if (q.status === "open") c.open += 1;
    if (q.status === "booked") c.booked += 1;
    counts.set(q.assigned_to, c);
  }

  const rows: MemberRow[] = ((profiles ?? []) as { id: string; full_name: string | null; role: string; status: string | null; phone: string | null; extra: Record<string, unknown> | null }[]).map((p) => {
    const a = authById.get(p.id);
    return {
      id: p.id,
      name: p.full_name || a?.email || "Unnamed",
      email: a?.email ?? "",
      phone: p.phone ?? "",
      emergencyId: typeof p.extra?.sales_emergency_contact_id === "string" ? (p.extra.sales_emergency_contact_id as string) : null,
      role: p.role,
      status: p.status === "disabled" ? "disabled" : "active",
      lastSignIn: a?.last_sign_in_at ?? null,
      counts: counts.get(p.id) ?? { total: 0, open: 0, booked: 0, draft: 0 },
    };
  });

  const team = rows.filter((r) => r.role === "sales_member" || r.role === "sales_admin").sort((a, b) => a.name.localeCompare(b.name));
  const leaders = rows.filter((r) => r.role === "super_admin" || r.role === "senior_manager").sort((a, b) => a.name.localeCompare(b.name));

  return <MembersManager team={team} leaders={leaders} me={user.id} />;
}
