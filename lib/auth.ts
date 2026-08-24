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

// Wrapped in React's cache() so that multiple calls within a single server
// render (middleware already validated the session; then layout.tsx AND the
// page body each call requireUser) share ONE result instead of each doing a
// fresh auth.getUser() + profiles query. Cache is per-request, so it never
// leaks between users. This removes several cross-region round-trips per page.
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
  return res;
}

export const isAdmin = (role?: string | null) =>
  role === "super_admin" || role === "general_manager";

export const isSuperAdmin = (role?: string | null) => role === "super_admin";
