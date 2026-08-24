import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role =
  | "super_admin"
  | "general_manager"
  | "resort_manager"
  | "department_head"
  | "accounts"
  | "viewer";

// Wrapped in React's cache() so the multiple requireUser() calls in one render
// (layout + page body) share ONE auth lookup instead of each doing a fresh
// getUser() + profiles query. Per-request; never leaks between users.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return { user, profile };
});

export async function requireUser() {
  const res = await getCurrentUser();
  if (!res?.user) redirect("/login");
  // Enforce account status: a deactivated user keeps their session cookie but
  // may not use the app. Send them to the public /account-inactive page (which
  // is excluded from the middleware auth redirect, so this cannot loop).
  if (res.profile && res.profile.status && res.profile.status !== "active") {
    redirect("/account-inactive");
  }
  return res;
}

export const isAdmin = (role?: string | null) =>
  role === "super_admin" || role === "general_manager";

export const isSuperAdmin = (role?: string | null) => role === "super_admin";
