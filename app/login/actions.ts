"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  // Block deactivated accounts at the door: sign the session back out and
  // show a clear message instead of letting them into the app.
  const uid = data.user?.id;
  if (uid) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", uid)
      .single();
    if (profile && profile.status && profile.status !== "active") {
      await supabase.auth.signOut();
      redirect(
        "/login?error=" +
          encodeURIComponent(
            "This account has been deactivated. Contact an administrator."
          )
      );
    }
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
