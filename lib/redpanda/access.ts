// Who may use Red Panda (pure; tested in access.test.ts). The database decides (rp_my_access:
// the super admin, or access given by person or role); the app adds that a Red Panda quote is a
// Sales query, so only Sales users get the tab. Only the super admin edits Master data and access.
// the Sales roles (as lib/auth.ts isSalesUser; that file is server-only)
const isSalesUser = (role?: string | null) => role === "super_admin" || role === "senior_manager" || role === "sales_admin" || role === "sales_member";

export interface RpAccess {
  canUse: boolean;
  isEditor: boolean;
}
export const NO_RP: RpAccess = { canUse: false, isEditor: false };

export function readAccess(data: unknown, role: string | null | undefined): RpAccess {
  const d = (data && typeof data === "object" ? data : {}) as { can_use?: unknown; is_editor?: unknown };
  const sales = isSalesUser(role);
  const isEditor = d.is_editor === true && role === "super_admin";
  return { canUse: sales && (d.can_use === true || isEditor), isEditor };
}

// The roles access can be given to (Sales roles; the super admin always has it).
export const RP_GRANTABLE_ROLES = ["senior_manager", "sales_admin", "sales_member"] as const;
