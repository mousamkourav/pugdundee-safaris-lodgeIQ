import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { inviteUser } from "./actions";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { profile } = await requireUser();
  if (!isAdmin(profile?.role)) redirect("/dashboard");
  const { error, ok } = await searchParams;

  // Service-role read so admins can see all profiles (RLS would hide others).
  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const supabase = await createClient();
  const { data: lodges } = await supabase
    .from("lodges")
    .select("id,name")
    .order("name");

  const rows = (profiles ?? []).map((p) => ({
    name: p.full_name ?? "—",
    role: (
      <span className="capitalize">{(p.role ?? "").replace("_", " ")}</span>
    ),
    status: p.status,
  }));

  return (
    <div className="space-y-10">
      <div>
        <PageHeader
          title="Users & access"
          description="Invite team members and set their role and lodges."
        />
        {ok && (
          <p className="mb-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
            User created.
          </p>
        )}
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            { key: "status", label: "Status" },
          ]}
          rows={rows}
        />
      </div>

      <div className="max-w-lg">
        <h2 className="mb-3 text-lg">Invite a user</h2>
        {error && (
          <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        <form
          action={inviteUser}
          className="space-y-4 rounded-xl border border-sand-200 bg-white p-6"
        >
          <Field name="full_name" label="Full name" required />
          <Field name="email" label="Email" type="email" required />
          <Field
            name="password"
            label="Temporary password"
            type="text"
            required
          />
          <div>
            <label className="mb-1 block text-sm text-sand-700">Role</label>
            <select
              name="role"
              className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
            >
              <option value="resort_manager">Resort manager</option>
              <option value="general_manager">General manager</option>
              {isSuperAdmin(profile?.role) && (
                <option value="super_admin">Super admin</option>
              )}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-sand-700">
              Assign lodges (for resort managers)
            </label>
            <div className="space-y-1 rounded-lg border border-sand-200 p-3">
              {(lodges ?? []).map((l) => (
                <label
                  key={l.id}
                  className="flex items-center gap-2 text-sm text-sand-700"
                >
                  <input type="checkbox" name="lodge_ids" value={l.id} />
                  {l.name}
                </label>
              ))}
              {(!lodges || lodges.length === 0) && (
                <p className="text-sm text-sand-500">
                  No lodges yet. Add a lodge first.
                </p>
              )}
            </div>
          </div>
          <button className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700">
            Create user
          </button>
        </form>
      </div>
    </div>
  );
}
