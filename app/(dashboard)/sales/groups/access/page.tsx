import { redirect } from "next/navigation";
import { requireUser, ROLE_LABELS, type Role } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GROUP_GRANTABLE_ROLES } from "@/lib/sales/group/access";
import { ui } from "@/components/ui";
import { GroupAccessEditor } from "@/components/sales/group/access-editor";

export const metadata = { title: "Group quote access - LodgeIQ" };

// Who may make group quotes: by person or by role (either is enough). Sales users only; the
// super admin always. Only the super admin opens this page (RLS checks again).
export default async function GroupAccessPage() {
  const { profile } = await requireUser();
  if (profile?.role !== "super_admin") redirect("/sales");
  const supabase = await createClient();
  const { data, error } = await supabase.from("sales_group_access").select("id, user_id, role, created_at").order("created_at");
  const { data: people } = await createAdminClient().from("profiles").select("id, full_name, role, status").in("role", [...GROUP_GRANTABLE_ROLES]).order("full_name");
  const ppl = ((people ?? []) as { id: string; full_name: string | null; role: Role; status: string | null }[]).filter((p) => (p.status ?? "active") === "active");
  const rows = ((data ?? []) as { id: string; user_id: string | null; role: string | null }[]).map((r) => ({
    id: r.id,
    label: r.role ? `Everyone with the role ${ROLE_LABELS[r.role as Role] ?? r.role}` : ppl.find((p) => p.id === r.user_id)?.full_name ?? "A person (inactive or not in Sales)",
  }));
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Sales</p>
        <h1 className="mt-1 text-2xl">Group quote access</h1>
        <p className="mt-1 text-sm text-sand-500">The super admin always has access. Give it to a Sales person (for example the general manager), or to everyone with a Sales role.</p>
      </div>
      {error && <p className={ui.alertError}>Could not load the access list: {/sales_group_access/.test(error.message) ? "run supabase/sales_group_quotes.sql in Supabase first." : error.message}</p>}
      <GroupAccessEditor
        rows={rows}
        people={ppl.map((p) => ({ id: p.id, label: `${p.full_name || "Unnamed"} (${ROLE_LABELS[p.role] ?? p.role})` }))}
        roles={GROUP_GRANTABLE_ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] }))}
      />
    </div>
  );
}
