# LodgeIQ — Password reset & change password

Adds forgot-password (logged out) + change-password (logged in), using Supabase's
built-in secure reset-link flow. No database changes.

## Files
- app/login/page.tsx                      adds "Forgot password?" link + reset banner.
- app/forgot-password/page.tsx + actions.ts   enter email -> Supabase emails a reset link.
- app/reset-password/page.tsx + actions.ts    the link lands here -> set new password.
- app/(dashboard)/account/page.tsx + actions.ts  logged-in: change password (verifies current).
- components/nav.ts                        adds "My account" under Overview.

## IMPORTANT — email delivery (SMTP)
The reset EMAIL is sent by Supabase. Check Supabase > Project Settings > Auth > SMTP:
- If custom SMTP is OFF (default): emails are rate-limited (~3-4/hour) and may hit
  spam. Fine for light use / testing, NOT reliable for production.
- Recommended: enable custom SMTP (Resend/SendGrid/Gmail) for reliable delivery.

Also set the redirect URL allow-list in Supabase > Auth > URL Configuration:
add your site URL and `<site>/reset-password` so the link works.

## Flow
- Forgot: /login -> "Forgot password?" -> enter email -> email link -> /reset-password -> new password -> /login.
- Change: sidebar "My account" -> enter current + new password.

## Build
npm run build  ->  "✓ Compiled successfully" before pushing.
