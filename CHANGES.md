# LodgeIQ — Task 2: Users & Access (full CRUD + real deactivation)

No database changes needed (profiles.status already exists; user_lodge_access
RLS is already correct). Install via Expand-Archive, then npm run dev.

## Files (5)
- lib/auth.ts                                  UPDATED  keeps the cache() perf fix
                                               AND enforces account status
                                               (inactive -> /account-inactive).
- middleware.ts                                UPDATED  perf getSession() + treats
                                               /account-inactive as public (no loop).
- app/login/actions.ts                         UPDATED  refuses deactivated accounts
                                               at sign-in with a clear message.
- app/account-inactive/page.tsx                NEW      public "account deactivated"
                                               notice with a sign-out button.
- app/(dashboard)/admin/users/page.tsx         REBUILT  management UI (see below).
- app/(dashboard)/admin/users/actions.ts       REBUILT  full CRUD server actions.

## What admins can now do (Users & access page)
- See every user with email, role, status (Active/Inactive) and assigned lodges.
- Edit role (super_admin option only visible to super admins).
- Add/remove lodge access via checkboxes (Save lodge access).
- Activate / Deactivate an account.
- Delete a user (super admin only) — removes access rows, profile, and auth user.

## Deactivation now actually blocks login (was cosmetic before)
- At login: a deactivated user is signed back out with a clear message.
- On any protected page: requireUser() redirects an inactive session to the
  public /account-inactive page (excluded from the middleware redirect, so it
  can't loop), where they can sign out.

## Guardrails
- You can't change your own role, deactivate yourself, or delete yourself.
- Only a super admin can grant super_admin or delete users.

## IMPORTANT — auth.ts note
This lib/auth.ts INCLUDES the earlier cache() performance fix, so installing it
will not regress speed even if your repo's copy differed. Safe to overwrite.

## Rollback
git checkout -- lib/auth.ts middleware.ts app/login/actions.ts \
  "app/(dashboard)/admin/users/page.tsx" "app/(dashboard)/admin/users/actions.ts"
and delete app/account-inactive/.
