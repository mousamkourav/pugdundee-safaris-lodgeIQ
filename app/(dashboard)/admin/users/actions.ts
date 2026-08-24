"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function back(msg?: { ok?: string; error?: string }) {
  revalidatePath("/admin/users");
  const q = msg?.error
    ? "?error=" + encodeURIComponent(msg.error)
    : msg?.ok
    ? "?ok=" + encodeURIComponent(msg.ok)
    : "";
  redirect("/admin/users" + q);
}

async function requireAdmin() {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");
  return cu;
}

// ---- Create a new user (invite) ----
export async function inviteUser(formData: FormData) {
  const cu = await requireAdmin();
  const role = String(formData.get("role") ?? "resort_manager");
  if (role === "super_admin" && !isSuperAdmin(cu.profile?.role)) {
    back({ error: "Only a super admin can create a super admin." });
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
    back({ error: error?.message ?? "Could not create user" });
    return;
  }
  const uid = created.user.id;
  // Always create the profile with an explicit active status.
  await admin
    .from("profiles")
    .upsert({ id: uid, full_name, role, status: "active" });
  if (lodgeIds.length > 0) {
    await admin
      .from("user_lodge_access")
      .insert(lodgeIds.map((lodge_id) => ({ user_id: uid, lodge_id })));
  }
  back({ ok: "User created." });
}

// ---- Update a user's role ----
export async function updateUserRole(formData: FormData) {
  const cu = await requireAdmin();
  const id = String(formData.get("id"));
  const role = String(formData.get("role"));
  if (role === "super_admin" && !isSuperAdmin(cu.profile?.role)) {
    back({ error: "Only a super admin can grant super admin." });
  }
  if (id === cu.user.id && !isSuperAdmin(role)) {
    // Don't let the last admin accidentally demote themselves out of access.
    back({ error: "You can't change your own role here." });
  }
  const admin = createAdminClient();
  await admin.from("profiles").update({ role }).eq("id", id);
  back({ ok: "Role updated." });
}

// ---- Replace a user's lodge assignments ----
export async function setUserLodges(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("user_id"));
  const lodgeIds = formData.getAll("lodge_ids").map(String);
  const admin = createAdminClient();
  // Simplest correct approach: clear then re-insert the chosen set.
  await admin.from("user_lodge_access").delete().eq("user_id", userId);
  if (lodgeIds.length > 0) {
    await admin
      .from("user_lodge_access")
      .insert(lodgeIds.map((lodge_id) => ({ user_id: userId, lodge_id })));
  }
  back({ ok: "Lodge access updated." });
}

// ---- Activate / deactivate ----
export async function setUserStatus(formData: FormData) {
  const cu = await requireAdmin();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")); // "active" | "inactive"
  if (id === cu.user.id && status !== "active") {
    back({ error: "You can't deactivate your own account." });
  }
  const admin = createAdminClient();
  await admin.from("profiles").update({ status }).eq("id", id);
  back({ ok: status === "active" ? "User activated." : "User deactivated." });
}

// ---- Hard delete (super admin only) ----
export async function deleteUser(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role)) {
    throw new Error("Not authorized");
  }
  const id = String(formData.get("id"));
  if (id === cu.user.id) {
    back({ error: "You can't delete your own account." });
  }
  const admin = createAdminClient();
  // Remove access rows first, then the profile, then the auth user.
  await admin.from("user_lodge_access").delete().eq("user_id", id);
  await admin.from("profiles").delete().eq("id", id);
  await admin.auth.admin.deleteUser(id);
  back({ ok: "User deleted." });
}

