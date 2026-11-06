import { requireRpEditor } from "@/lib/redpanda/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { RP_GRANTABLE_ROLES } from "@/lib/redpanda/access";
import { RpAccessEditor } from "@/components/redpanda/access-editor";

export const metadata = { title: "Red Panda access - LodgeIQ" };

// Who may use Red Panda: by person or by role (either is enough). Sales users only (a quote is a
// Sales query); the super admin always.
export default async function RedPandaAccessPage() {
  await requireRpEditor();
  const supabase = await createClient();
  const { data } = await supabase.from("rp_access").select("id, user_id, role, created_at").order("created_at");
  const { data: people } = await createAdminClient().from("profiles").select("id, full_name, role, status").in("role", ["senior_manager", "sales_admin", "sales_member"]).order("full_name");
  const ppl = ((people ?? []) as { id: string; full_name: string | null; role: Role; status: string | null }[]).filter((p) => (p.status ?? "active") === "active");
  const rows = ((data ?? []) as { id: string; user_id: string | null; role: string | null }[]).map((r) => ({
    id: r.id,
    label: r.role ? `Everyone with the role ${ROLE_LABELS[r.role as Role] ?? r.role}` : ppl.find((p) => p.id === r.user_id)?.full_name ?? "A person (inactive or not in Sales)",
  }));
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Red Panda Outpost</p>
        <h1 className="mt-1 text-2xl">Access</h1>
        <p className="mt-1 text-sm text-sand-500">The super admin always has access. Give it to a Sales person, or to everyone with a Sales role.</p>
      </div>
      <RpAccessEditor
        rows={rows}
        people={ppl.map((p) => ({ id: p.id, label: `${p.full_name || "Unnamed"} (${ROLE_LABELS[p.role] ?? p.role})` }))}
        roles={RP_GRANTABLE_ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] }))}
      />
    </div>
  );
}
