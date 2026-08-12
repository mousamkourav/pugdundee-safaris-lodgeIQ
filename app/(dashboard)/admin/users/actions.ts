"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin, isSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function inviteUser(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isAdmin(cu.profile?.role)) throw new Error("Not authorized");

  const role = String(formData.get("role") ?? "resort_manager");

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
  await admin.from("profiles").upsert({ id: uid, full_name, role });

  // Assign lodges (only meaningful for resort managers; admins see all lodges).
  if (role === "resort_manager" && lodgeIds.length > 0) {
    await admin
      .from("user_lodge_access")
      .insert(lodgeIds.map((lodge_id) => ({ user_id: uid, lodge_id })));
  }

  revalidatePath("/admin/users");
  redirect("/admin/users?ok=1");
}
