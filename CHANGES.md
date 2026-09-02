# LodgeIQ — Fix "Auth session missing" on password reset

The reset link now goes through an auth callback that exchanges the code for a
session BEFORE the reset form loads. Fixes the "Auth session missing!" error.

## Files
- app/auth/callback/route.ts          NEW  exchanges ?code=... for a session,
                                      then redirects to /reset-password.
- app/forgot-password/actions.ts      redirect now targets /auth/callback.

## ALSO REQUIRED — two manual steps

### 1. middleware.ts — allow /auth/callback (public)
Add `/auth/callback` to the public routes (run the PowerShell below).

### 2. Supabase Redirect URLs
Add this to Supabase > Auth > URL Configuration > Redirect URLs:
  https://pugdundee-safaris-lodge-iq.vercel.app/auth/callback

## Build
npm run build -> "✓ Compiled successfully" before pushing.
