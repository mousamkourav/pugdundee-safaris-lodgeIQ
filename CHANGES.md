# LodgeIQ — Performance fixes (Fix 1 + Fix 2)

Cuts the number of cross-region Supabase round-trips per page load and per action.
No behavior or security change. Install via your usual Expand-Archive flow, then
`npm run dev`. These help BOTH local and production.

## Files (2)
- lib/auth.ts      Fix 1: getCurrentUser wrapped in React cache() — the 3-5
                   requireUser() calls per render now share ONE auth lookup.
- middleware.ts    Fix 2: routing decision uses getSession() (local cookie read)
                   instead of getUser() (network call to Supabase Auth) on every
                   request. Real auth is still enforced by requireUser()+RLS.

## Why this is safe
- Fix 1 uses request-scoped caching; it never leaks between users/requests.
- Fix 2 only changes the login-redirect decision. Every protected page still
  calls requireUser() -> getUser() (revalidates against Auth), and the database
  still enforces RLS. Worst case for a stale cookie: one page load that
  immediately redirects to /login. No data exposure.

## Also do (no code): redeploy so the Vercel Singapore region takes effect
You already switched Vercel to Singapore (sin1). It applies on the NEXT deploy.
Ship these fixes + redeploy together and production latency should drop sharply
(Supabase is in ap-southeast-1 / Singapore, so app and DB will be co-located).

## Expected result
- Local (India -> Singapore): noticeably snappier from Fix 1 + 2.
- Production: snappier from Fix 1 + 2, and a big drop once the Singapore
  deploy is live (co-located with Supabase).

## Rollback
If anything looks off, restore your previous lib/auth.ts and middleware.ts from
git (git checkout -- lib/auth.ts middleware.ts). No DB changes were made.
