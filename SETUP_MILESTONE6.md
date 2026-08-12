# Milestone 6 — Notifications (email)

Adds the notification engine: a scan that finds overdue/due-soon services and unsent
alerts (including bar rate changes), emails the right people, and shows an in-app inbox.
WhatsApp is intentionally left for later — the design already has a clean slot for it.

## Changed vs new files
- **Changed:** `middleware.ts` (lets the /api cron route through), `components/nav.ts`
  (adds "Notifications"), `.env.local.example` (adds email/cron keys).
- **New:** `lib/notify/*`, `app/(dashboard)/notifications/*`,
  `app/api/cron/notifications/route.ts`, `vercel.json`.

## One external account: Resend (free)
1. Sign up at resend.com and verify your email.
2. Create an **API key** (Dashboard → API Keys).
3. Add these to your `.env.local` (dev):
   ```
   RESEND_API_KEY=re_...your key...
   EMAIL_FROM=LodgeIQ <onboarding@resend.dev>
   CRON_SECRET=any-long-random-string
   ```
   `onboarding@resend.dev` works immediately for testing. To send from
   alerts@pugdundeesafaris.com, verify your domain in Resend later and change EMAIL_FROM.
4. **Restart the dev server** after editing `.env.local` (`Ctrl+C`, then `npm run dev`).

## Install
1. Unzip, copy into your repo root (keep structure), replace the 3 changed files when asked.
2. One new dependency is already listed in package.json (`resend`). Install it:
   ```
   npm install
   npm run dev
   ```

## Who gets emailed
For each alert's lodge: all **super admins** and **general managers**, plus the
**resort manager(s) assigned to that lodge**. (Emails come from each user's login, so
invite people via Users & Access.)

## How to test now (button)
1. Go to **Notifications** → click **Run checks now** (super admin / GM only).
2. It scans assets: any **overdue** or **due-soon (≤14 days)** service creates an alert.
   - If you added the overdue Fire Extinguisher earlier, you'll see a red Critical alert.
3. It then emails all pending alerts (service-due + any bar rate changes) and marks them sent.
4. Change a **bar item's rate** → run checks again → that rate-change alert emails too.
5. Check your inbox (and Resend's dashboard → Emails, to see delivery).

Before Resend is configured, alerts still appear in the in-app inbox (they just wait to
be emailed). Once the key is set, the next run sends them.

## Automatic daily scan (after you deploy to Vercel)
`vercel.json` already schedules a daily run at 03:00 UTC. After deploying:
- In Vercel → Project → **Settings → Environment Variables**, add `CRON_SECRET`
  (same value as local) plus `RESEND_API_KEY` and `EMAIL_FROM`.
- Vercel automatically sends the secret with each cron call; the endpoint rejects
  anything else. No other setup needed.

## Commit (dev branch)
```
git add .
git commit -m "Milestone 6: email notifications engine + cron"
git push
```

## Next
Milestone 7 — Reports & analytics (monthly report generate/submit/export; cross-lodge
dashboards). Then WhatsApp delivery can be added to lib/notify with no structural change.
