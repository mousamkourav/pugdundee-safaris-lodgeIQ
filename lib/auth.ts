import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role =
  | "super_admin"
  | "general_manager"
  | "resort_manager"
  | "department_head"
  | "accounts"
  | "viewer";

export async function getCurrentUser() {
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
}

export async function requireUser() {
  const res = await getCurrentUser();
  if (!res?.user) redirect("/login");
  return res;
}

export const isAdmin = (role?: string | null) =>
  role === "super_admin" || role === "general_manager";

export const isSuperAdmin = (role?: string | null) => role === "super_admin";
