import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { changePassword } from "./actions";
import { ProfileForm } from "./profile-form";
import { createClient } from "@/lib/supabase/server";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; changed?: string; psaved?: string; perror?: string }>;
}) {
  const { profile } = await requireUser();
  const sb = await createClient();
  const { data: profileRow } = await sb
    .from("profiles")
    .select("id, full_name, designation, phone, avatar_url")
    .eq("id", (profile as { id?: string })?.id ?? "")
    .maybeSingle();
  const pr = (profileRow as { id: string; full_name: string | null; designation: string | null; phone: string | null; avatar_url: string | null } | null);
  const { error, changed, psaved, perror } = await searchParams;

  return (
    <div>
      <PageHeader title="My account" description="Manage your sign-in details" />

      <div className="max-w-md space-y-6">
        <div className="rounded-xl border border-sand-200 bg-white p-5">
            <h3 className="mb-3 text-base font-medium text-sand-800">Profile</h3>
            {psaved && (
              <p className="mb-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">Profile updated.</p>
            )}
            {perror && (
              <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{perror}</p>
            )}
            <div className="mb-4 flex justify-between border-b border-sand-100 py-1.5 text-sm">
              <span className="text-sand-500">Role</span>
              <span className="capitalize text-sand-800">{String(profile?.role ?? "").replace(/_/g, " ")}</span>
            </div>
            <ProfileForm
              userId={pr?.id ?? ""}
              fullName={pr?.full_name ?? ""}
              designation={pr?.designation ?? ""}
              phone={pr?.phone ?? ""}
              avatarUrl={pr?.avatar_url ?? ""}
            />
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
