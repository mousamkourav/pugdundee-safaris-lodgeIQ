import { redirect } from "next/navigation";
import { requireUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/field";
import {
  inviteUser,
  updateUserRole,
  setUserLodges,
  setUserStatus,
  deleteUser,
} from "./actions";

type Profile = {
  id: string;
  full_name: string | null;
  role: string;
  status: string;
};
type Lodge = { id: string; name: string };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "resort_manager", label: "Resort manager" },
  { value: "general_manager", label: "General manager" },
  { value: "department_head", label: "Department head" },
  { value: "accounts", label: "Accounts" },
  { value: "viewer", label: "Viewer" },
  { value: "super_admin", label: "Super admin" },
];

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { profile, user } = await requireUser();
  if (!isAdmin(profile?.role)) redirect("/dashboard");
  const { error, ok } = await searchParams;
  const superAdmin = isSuperAdmin(profile?.role);

  const admin = createAdminClient();
  const [{ data: profilesData }, { data: lodgesData }, { data: accessData }] =
    await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: true }),
      admin.from("lodges").select("id,name").order("name"),
      admin.from("user_lodge_access").select("user_id,lodge_id"),
    ]);

  // Emails live in auth.users; fetch and map by id.
  const emailById = new Map<string, string>();
  try {
    const { data: authList } = await admin.auth.admin.listUsers();
    for (const u of authList?.users ?? []) {
      if (u.id && u.email) emailById.set(u.id, u.email);
    }
  } catch {
    // If listing fails, we simply show no email — non-fatal.
  }

  const profiles = (profilesData ?? []) as Profile[];
  const lodges = (lodgesData ?? []) as Lodge[];
  const access = (accessData ?? []) as { user_id: string; lodge_id: string }[];

  const lodgesByUser = new Map<string, Set<string>>();
  for (const a of access) {
    if (!lodgesByUser.has(a.user_id)) lodgesByUser.set(a.user_id, new Set());
    lodgesByUser.get(a.user_id)!.add(a.lodge_id);
  }
  const lodgeName = (id: string) =>
    lodges.find((l) => l.id === id)?.name ?? "—";

  return (
    <div className="space-y-10">
      <div>
        <PageHeader
          title="Users & access"
          description="Manage team members: role, lodge access, and account status."
        />
        {ok && (
          <p className="mb-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
            {ok}
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}

        <div className="space-y-4">
          {profiles.map((p) => {
            const assigned = lodgesByUser.get(p.id) ?? new Set<string>();
            const isSelf = p.id === user.id;
            const active = p.status === "active";
            return (
              <div
                key={p.id}
                className="rounded-xl border border-sand-200 bg-white p-5"
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sand-800">
                      {p.full_name ?? "—"}
                      {isSelf && (
                        <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info">
                          You
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-sand-500">
                      {emailById.get(p.id) ?? "—"}
                    </p>
                  </div>
                  <span
                    className={
                      "rounded-full px-2.5 py-0.5 text-xs " +
                      (active
                        ? "bg-success-bg text-success"
                        : "bg-sand-100 text-sand-600")
                    }
                  >
                    {active ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Role */}
                  <form action={updateUserRole} className="space-y-2">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="block text-xs text-sand-500">Role</label>
                    <select
                      name="role"
                      defaultValue={p.role}
                      disabled={isSelf}
                      className={inputCls}
                    >
                      {ROLE_OPTIONS.filter(
                        (r) => r.value !== "super_admin" || superAdmin
                      ).map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={isSelf}
                      className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50 disabled:opacity-40"
                    >
                      Save role
                    </button>
                  </form>

                  {/* Lodge access */}
                  <form
                    action={setUserLodges}
                    className="space-y-2 lg:col-span-2"
                  >
                    <input type="hidden" name="user_id" value={p.id} />
                    <label className="block text-xs text-sand-500">
                      Lodge access
                    </label>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-sand-200 p-3">
                      {lodges.length === 0 && (
                        <span className="text-sm text-sand-500">
                          No lodges yet.
                        </span>
                      )}
                      {lodges.map((l) => (
                        <label
                          key={l.id}
                          className="flex items-center gap-2 text-sm text-sand-700"
                        >
                          <input
                            type="checkbox"
                            name="lodge_ids"
                            value={l.id}
                            defaultChecked={assigned.has(l.id)}
                          />
                          {l.name}
                        </label>
                      ))}
                    </div>
                    <button className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50">
                      Save lodge access
                    </button>
                  </form>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sand-100 pt-4">
                  {/* Activate / deactivate */}
                  <form action={setUserStatus}>
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={active ? "inactive" : "active"}
                    />
                    <button
                      disabled={isSelf && active}
                      className={
                        "rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 " +
                        (active
                          ? "border border-sand-200 text-sand-700 hover:bg-sand-50"
                          : "bg-olive-600 text-white hover:bg-olive-700")
                      }
                    >
                      {active ? "Deactivate" : "Activate"}
                    </button>
                  </form>

                  {/* Delete (super admin only) */}
                  {superAdmin && !isSelf && (
                    <form action={deleteUser} className="ml-auto">
                      <input type="hidden" name="id" value={p.id} />
                      <button className="rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error-bg">
                        Delete
                      </button>
                    </form>
                  )}
                </div>

                {assigned.size > 0 && (
                  <p className="mt-3 text-xs text-sand-500">
                    Currently:{" "}
                    {[...assigned].map((id) => lodgeName(id)).join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-lg">
        <h2 className="mb-3 text-lg">Invite a user</h2>
        <form
          action={inviteUser}
          className="space-y-4 rounded-xl border border-sand-200 bg-white p-6"
        >
          <Field name="full_name" label="Full name" required />
          <Field name="email" label="Email" type="email" required />
          <Field name="password" label="Temporary password" type="text" required />
          <div>
            <label className="mb-1 block text-sm text-sand-700">Role</label>
            <select name="role" className={inputCls}>
              {ROLE_OPTIONS.filter(
                (r) => r.value !== "super_admin" || superAdmin
              ).map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-sand-700">
              Assign lodges
            </label>
            <div className="space-y-1 rounded-lg border border-sand-200 p-3">
              {lodges.map((l) => (
                <label
                  key={l.id}
                  className="flex items-center gap-2 text-sm text-sand-700"
                >
                  <input type="checkbox" name="lodge_ids" value={l.id} />
                  {l.name}
                </label>
              ))}
              {lodges.length === 0 && (
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
