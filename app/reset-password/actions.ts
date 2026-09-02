"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect("/reset-password?error=" + encodeURIComponent("Password must be at least 8 characters"));
  }
  if (password !== confirm) {
    redirect("/reset-password?error=" + encodeURIComponent("Passwords do not match"));
  }

  const supabase = await createClient();
  // The reset link established a session; updateUser sets the new password.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/reset-password?error=" + encodeURIComponent(error.message));
  }
  redirect("/login?reset=1");
}
