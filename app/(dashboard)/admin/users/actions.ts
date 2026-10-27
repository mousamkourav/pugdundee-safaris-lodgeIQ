"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function inviteUser(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");

  const role = String(formData.get("role") ?? "lodge_manager");

  // Only a super admin may create a super admin.
  if (role === "super_admin" && !isSuperAdmin(cu.profile?.role)) {
    redirect(
      "/admin/users?error=" +
        encodeURIComponent("Only a super admin can create a super admin.")
    );
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const full_name = String(formData.get("full_name") ?? "");
  const lodgeIds = formData.getAll("lodge_ids").map(String);

  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (error || !created?.user) {
    redirect(
      "/admin/users?error=" +
        encodeURIComponent(error?.message ?? "Could not create user")
    );
  }

  const uid = created.user.id;

  // Ensure the profile row exists with the chosen role + name.
  const { error: profileError } = await admin.from("profiles").upsert({ id: uid, full_name, role });
  if (profileError) {
    redirect(
      "/admin/users?error=" +
        encodeURIComponent("User created but profile failed: " + profileError.message)
    );
  }

  // Assign lodges (only meaningful for resort managers; admins see all lodges).
  if (["lodge_manager","operations_manager","lodge_accounts"].includes(role) && lodgeIds.length > 0) {
    await admin
      .from("user_lodge_access")
      .insert(lodgeIds.map((lodge_id) => ({ user_id: uid, lodge_id })));
  }

  revalidatePath("/admin/users");
  redirect("/admin/users?ok=1");
}

// A password the user can use straight away (the same rule as for Sales members).
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "The password needs at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "The password needs at least one letter and one number.";
  return null;
}

// The super admin sets a new password for a member (when the reset link does not reach them).
// The member signs in with it at once; tell them to change it under My account.
export async function setUserPassword(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role)) redirect("/admin/users?pwerror=" + encodeURIComponent("Only a super admin can set passwords."));

  const userId = String(formData.get("user_id") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const back = (msg: string, ok = false) => redirect(`/admin/users?${ok ? "pw" : "pwerror"}=${encodeURIComponent(msg)}`);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) back("Choose a user.");
  const problem = passwordProblem(password);
  if (problem) back(problem);

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, full_name, role").eq("id", userId).maybeSingle();
  if (!target) back("That user no longer exists.");
  const t = target as { full_name: string | null; role: string | null };
  // only a super admin may change another super admin's password
  if (t.role === "super_admin" && cu.profile?.role !== "super_admin") back("Only a super admin can change a super admin's password.");

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) back("The password could not be changed: " + error.message);

  // for the record: who changed whose password, never the password itself
  await admin
    .from("audit_log")
    .insert({ actor: cu.user.id, action: "password_set_by_admin", table_name: "profiles", record_id: userId, diff: { user: t.full_name, at: new Date().toISOString() } })
    .then(() => undefined, () => undefined);

  revalidatePath("/admin/users");
  back(`New password saved for ${t.full_name || "the user"}. They can sign in with it now.`, true);
}
