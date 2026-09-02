import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { changePassword } from "./actions";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; changed?: string }>;
}) {
  const { profile } = await requireUser();
  const { error, changed } = await searchParams;

  return (
    <div>
      <PageHeader title="My account" description="Manage your sign-in details" />

      <div className="max-w-md space-y-6">
        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h3 className="mb-3 text-base font-medium text-sand-800">Profile</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b border-sand-100 py-1.5">
              <span className="text-sand-500">Name</span>
              <span className="text-sand-800">{profile?.full_name ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-sand-500">Role</span>
              <span className="capitalize text-sand-800">
                {String(profile?.role ?? "").replace(/_/g, " ")}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h3 className="mb-3 text-base font-medium text-sand-800">Change password</h3>

          {changed && (
            <p className="mb-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
              Password updated successfully.
            </p>
          )}
          {error && (
            <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          <form action={changePassword} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-sand-700">Current password</label>
              <input
                name="current"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-sand-700">New password</label>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-sand-700">Confirm new password</label>
              <input
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
              />
            </div>
            <button className="rounded-lg bg-olive-600 px-5 py-2 text-sm font-medium text-white hover:bg-olive-700">
              Update password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
