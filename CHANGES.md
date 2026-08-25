# LodgeIQ — New role system (replaces old roles)

Replaces the old roles with: super_admin (you, kept as safety net) + senior_manager,
delhi_accounts, lodge_manager, operations_manager, lodge_accounts.

TWO PARTS — run the SQL FIRST, then deploy the code (or the app will reference roles
the DB constraint rejects).

## STEP 1 — Supabase
Run roles_migration.sql (provided separately). It:
- migrates your 3 existing users (super_admin kept; resort_manager -> lodge_manager),
- swaps the profiles.role check constraint to the new set,
- updates is_admin() (all lodges: super_admin, senior_manager, delhi_accounts) and
  is_super_admin() (full control: super_admin, senior_manager).

## STEP 2 — this code
- lib/auth.ts                         new Role type, ROLE_LABELS, ADMIN_ROLES,
                                      SUPER_ROLES, updated isAdmin/isSuperAdmin.
- app/(dashboard)/admin/users/page.tsx     new role dropdown.
- app/(dashboard)/admin/users/actions.ts   default role + lodge-assign logic.
- app/(dashboard)/monthly/page.tsx         delete gate -> isSuperAdmin.
- app/(dashboard)/monthly/actions.ts       delete gate -> isSuperAdmin (keeps
                                           the merge-safe save from before).
- app/(dashboard)/layout.tsx               default fallback -> lodge_manager.
- components/nav.ts                        admin-only items gated on new roles.

## Permission model
- See ALL lodges: super_admin, senior_manager, delhi_accounts.
- See OWN lodge only: lodge_manager, operations_manager, lodge_accounts.
- Manage users / delete: super_admin, senior_manager.

## Build
npm run build -> "✓ Compiled successfully" before pushing.

## Order matters
Run the SQL before deploying, so existing sessions don't hit a role the constraint
rejects. Your login stays valid (super_admin unchanged).
