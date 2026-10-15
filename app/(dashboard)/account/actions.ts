"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export async function changePassword(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) redirect("/login");

  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect("/account?error=" + encodeURIComponent("New password must be at least 8 characters"));
  }
  if (password !== confirm) {
    redirect("/account?error=" + encodeURIComponent("Passwords do not match"));
  }

  const supabase = await createClient();

  // Verify the current password by re-authenticating (Supabase has no direct check).
  const email = cu.user.email ?? "";
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password: current,
  });
  if (signInErr) {
    redirect("/account?error=" + encodeURIComponent("Current password is incorrect"));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/account?error=" + encodeURIComponent(error.message));
  }
  redirect("/account?changed=1");
}

export async function updateProfile(formData: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) redirect("/login");

  const full_name = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const designation = String(formData.get("designation") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 30);
  const avatar_url = String(formData.get("avatar_url") ?? "").trim().slice(0, 500);

  if (!full_name) {
    redirect("/account?perror=" + encodeURIComponent("Name cannot be empty"));
  }

  const supabase = await createClient();
  const patch: Record<string, string | null> = {
    full_name,
    designation: designation || null,
    phone: phone || null,
  };
  if (avatar_url) patch.avatar_url = avatar_url;

  const { error } = await supabase.from("profiles").update(patch).eq("id", cu.user.id);
  if (error) {
    redirect("/account?perror=" + encodeURIComponent(error.message));
  }
  redirect("/account?psaved=1");
}
