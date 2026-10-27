import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { Field } from "@/components/field";
import { inviteUser, setUserPassword } from "./actions";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; pw?: string; pwerror?: string }>;
}) {
  const { profile } = await requireUser();
  if (!isAdmin(profile?.role)) redirect("/dashboard");
  const { error, ok, pw, pwerror } = await searchParams;
  const canSetPasswords = isSuperAdmin(profile?.role);

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

  // sign-in emails (they live in Supabase Auth, not in profiles)
  const emails = new Map<string, string>();
  if (canSetPasswords) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const u of list?.users ?? []) emails.set(u.id, u.email ?? "");
  }

  const rows = (profiles ?? []).map((p) => ({
    name: p.full_name ?? "—",
    email: emails.get(p.id) ?? "",
    password:
      canSetPasswords && (p.role !== "super_admin" || profile?.role === "super_admin") ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-sm font-medium text-olive-700 hover:underline">Set password</summary>
          <form action={setUserPassword} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="user_id" value={p.id} />
            <input
              name="password"
              type="text"
              required
              minLength={8}
              autoComplete="off"
              placeholder="New password"
              aria-label={`New password for ${p.full_name ?? "this user"}`}
              className="w-40 rounded-lg border border-sand-300 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-gold-500"
            />
            <button className="rounded-lg bg-olive-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-olive-700">Save</button>
          </form>
        </details>
      ) : null,
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
        {pw && <p className="mb-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">{pw}</p>}
        {pwerror && <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{pwerror}</p>}
        {canSetPasswords && (
          <p className="mb-3 text-sm text-sand-500">
            Set password: for when the reset link does not reach someone. At least 8 characters with a letter and a number; they can sign in with it at once and change it under My account.
          </p>
        )}
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            ...(canSetPasswords ? [{ key: "email", label: "Email" }] : []),
            { key: "role", label: "Role" },
            { key: "status", label: "Status" },
            ...(canSetPasswords ? [{ key: "password", label: "Password" }] : []),
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
              <option value="lodge_manager">Lodge manager</option>
              <option value="operations_manager">Operations manager</option>
              <option value="lodge_accounts">Lodge accounts</option>
              <option value="sales_member">Sales member</option>
              {isSuperAdmin(profile?.role) && (
                <>
                  <option value="senior_manager">Senior manager</option>
                  <option value="delhi_accounts">Delhi accounts</option>
                  <option value="super_admin">Super admin</option>
                </>
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
