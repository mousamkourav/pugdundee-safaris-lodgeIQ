// Who may do what in the SOP module. The same rules are in the database (supabase/sop_module.sql:
// sop_can_view, sop_is_editor and the RLS policies); these copies drive the screens and tests.
//
// - super_admin: everything (edit, import, publish, versions, access, who has read).
// - everyone else: sees the SOP only when given access, by person or by role (either is enough).
//   Deactivated accounts never (they are turned away before any page loads).

// Only the super admin edits. (Senior managers count as "super" elsewhere in LodgeIQ; not here.)
export const SOP_EDITOR_ROLE = "super_admin";
export const isSopEditor = (role?: string | null) => role === SOP_EDITOR_ROLE;

export interface AccessRow {
  id?: string;
  user_id: string | null;
  role: string | null;
}

export function canViewSop(userId: string | null | undefined, role: string | null | undefined, rows: AccessRow[]): boolean {
  if (isSopEditor(role)) return true;
  if (!userId) return false;
  return rows.some((r) => (r.user_id && r.user_id === userId) || (!!r.role && r.role === role));
}

// What the layout needs on every page (from the database function sop_my_status()).
export interface SopStatus {
  canView: boolean;
  isEditor: boolean;
  documentId: string | null;
  version: number | null; // the current (live) version
  versionId: string | null;
  // Every save makes a version; staff are asked to read only those the super admin ticked
  // "Ask staff to read this update" for. The latest of those, and whether this user read it.
  readVersion: number | null;
  readVersionId: string | null;
  read: boolean;
}
export const NO_SOP: SopStatus = { canView: false, isEditor: false, documentId: null, version: null, versionId: null, readVersion: null, readVersionId: null, read: false };

// The status as the database returns it (json), read defensively: anything odd = no access.
export function readStatus(raw: unknown): SopStatus {
  if (!raw || typeof raw !== "object") return NO_SOP;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    canView: r.can_view === true,
    isEditor: r.is_editor === true,
    documentId: str(r.document_id),
    version: int(r.version),
    versionId: str(r.version_id),
    readVersion: int(r.read_version),
    readVersionId: str(r.read_version_id),
    read: r.read === true,
  };
}

// "New SOP version - please read": staff with access, when the super admin asked them to read a
// version and they have not said "I have read" it yet. The super admin is not asked.
export const showReadBanner = (s: SopStatus) => s.canView && !s.isEditor && s.readVersion != null && !!s.readVersionId && !s.read;

// ---------------------------------------------------------------- who has read a version

export interface Person {
  id: string;
  full_name: string | null;
  role: string | null;
  status?: string | null;
}
export interface ReadRow {
  id: string;
  name: string;
  role: string;
  lodges: string;
  readAt: string | null;
}

// Staff a version is for: active, with access, not the super admin.
export function audience(people: Person[], rows: AccessRow[]): Person[] {
  return people.filter((p) => (p.status ?? "active") === "active" && !isSopEditor(p.role) && canViewSop(p.id, p.role, rows));
}

// One line per person: not read first, then by name.
export function readReport(people: Person[], rows: AccessRow[], reads: { user_id: string; read_at: string }[], lodgesOf: (userId: string) => string[], roleLabel: (role: string) => string): ReadRow[] {
  const at = new Map(reads.map((r) => [r.user_id, r.read_at]));
  return audience(people, rows)
    .map((p) => ({
      id: p.id,
      name: p.full_name || "(no name)",
      role: p.role ? roleLabel(p.role) : "",
      lodges: lodgesOf(p.id).join(", "),
      readAt: at.get(p.id) ?? null,
    }))
    .sort((a, b) => Number(!!a.readAt) - Number(!!b.readAt) || a.name.localeCompare(b.name));
}
