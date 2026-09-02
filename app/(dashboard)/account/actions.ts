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
