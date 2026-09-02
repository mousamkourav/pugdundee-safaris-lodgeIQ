"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function requestReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/forgot-password?error=" + encodeURIComponent("Enter your email"));

  const supabase = await createClient();
  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? "";

  // Supabase sends an email with a link to /reset-password where the user sets a new password.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // Always show success (don't reveal whether an email exists — privacy best practice).
  if (error) {
    // Log-worthy but still show generic success to the user.
    console.error("resetPasswordForEmail:", error.message);
  }
  redirect("/forgot-password?sent=1");
}
