"use server";

import { safe } from "@/lib/sales/safe";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Sales members are managed here, separately from the lodge users in
// Users & access. Only Sales admins (and super admins) may use these, and only
// for the two Sales roles: lodge and super-admin accounts cannot be touched.
const SALES_TEAM_ROLES = ["sales_member", "sales_admin"] as const;
type SalesRole = (typeof SALES_TEAM_ROLES)[number];
type Result = { ok?: boolean; error?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isSalesRole = (r: unknown): r is SalesRole => SALES_TEAM_ROLES.includes(r as SalesRole);

function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "The password needs at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "The password needs at least one letter and one number.";
  return null;
}

async function requireSalesAdmin() {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return null;
  return cu;
}

async function createSalesMemberUnsafe(input: { full_name: string; email: string; phone: string; role: string; password: string }): Promise<Result> {
  if (!(await requireSalesAdmin())) return { error: "Only Sales admins can add members." };
  const full_name = input.full_name.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase();
  if (!full_name) return { error: "Enter the member's name." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (!isSalesRole(input.role)) return { error: "Choose Sales member or Sales admin." };
  const pwErr = passwordProblem(input.password);
  if (pwErr) return { error: pwErr };

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error || !created?.user) {
    const msg = error?.message ?? "Could not create the account.";
    return {
      error: /already|registered|exists/i.test(msg)
        ? "An account with this email already exists. If that person should join Sales, a super admin can change their role in Users & access."
        : msg,
    };
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: created.user.id, full_name, role: input.role, status: "active", phone: input.phone.trim() || null });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id); // do not leave a login without a profile
    return { error: "Could not save the member's profile: " + profileError.message };
  }
  revalidatePath("/sales/members");
  revalidatePath("/sales");
  return { ok: true };
}

async function updateSalesMemberUnsafe(
  id: string,
  input: { full_name?: string; phone?: string; role?: string; status?: string; password?: string; emergency_id?: string | null }
): Promise<Result> {
  const cu = await requireSalesAdmin();
  if (!cu) return { error: "Only Sales admins can change members." };

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, role, extra").eq("id", id).maybeSingle();
  if (!target) return { error: "Member not found." };
  if (!isSalesRole((target as { role: string }).role)) {
    return { error: "This account is not a Sales member, so it is managed in Users & access." };
  }
  const self = cu.user.id === id;
  if (self && ((input.role && input.role !== (target as { role: string }).role) || input.status === "disabled")) {
    return { error: "You cannot change your own role or deactivate yourself. Ask another admin." };
  }

  const patch: Record<string, unknown> = {};
  if (input.full_name !== undefined) {
    const n = input.full_name.trim().slice(0, 120);
    if (!n) return { error: "The name cannot be empty." };
    patch.full_name = n;
  }
  if (input.phone !== undefined) patch.phone = input.phone.trim() || null;
  if (input.role !== undefined) {
    if (!isSalesRole(input.role)) return { error: "Choose Sales member or Sales admin." };
    patch.role = input.role;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "disabled") return { error: "Unknown status." };
    patch.status = input.status;
  }
  // The emergency contact printed on this member's guest itineraries (another Sales member).
  if (input.emergency_id !== undefined) {
    const extra = { ...(((target as { extra?: Record<string, unknown> }).extra ?? {}) as Record<string, unknown>) };
    if (input.emergency_id) {
      if (input.emergency_id === id) return { error: "Choose someone else as the emergency contact." };
      const { data: other } = await admin.from("profiles").select("id, role").eq("id", input.emergency_id).maybeSingle();
      if (!other || !isSalesRole((other as { role: string }).role)) return { error: "The emergency contact must be a Sales member." };
      extra.sales_emergency_contact_id = input.emergency_id;
    } else delete extra.sales_emergency_contact_id;
    patch.extra = extra;
  }
  if (Object.keys(patch).length) {
    const { error } = await admin.from("profiles").update(patch).eq("id", id);
    if (error) return { error: error.message };
  }
  if (input.password) {
    const pwErr = passwordProblem(input.password);
    if (pwErr) return { error: pwErr };
    const { error } = await admin.auth.admin.updateUserById(id, { password: input.password });
    if (error) return { error: "Details saved, but the password could not be changed: " + error.message };
  }
  revalidatePath("/sales/members");
  revalidatePath("/sales");
  return { ok: true };
}

// Public actions: failures come back as { error } instead of crashing.
export async function createSalesMember(input: { full_name: string; email: string; phone: string; role: string; password: string }): Promise<Result> {
  return safe("createSalesMember", () => createSalesMemberUnsafe(input));
}
export async function updateSalesMember(
  id: string,
  input: { full_name?: string; phone?: string; role?: string; status?: string; password?: string; emergency_id?: string | null }
): Promise<Result> {
  return safe("updateSalesMember", () => updateSalesMemberUnsafe(id, input));
}
