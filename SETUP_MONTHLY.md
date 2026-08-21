# Monthly Report system — Step 1 of the reshape

This shifts the app to the model your owner wants: each lodge manager fills ONE
monthly report (totals, not daily rows), submits it, and it locks. Super admin can
edit/delete anything.

## STEP 1 — Database (Supabase, required first)
In Supabase -> SQL Editor, run **schema_monthly.sql** (provided separately).
Expect "Success. No rows returned". Run it on prod too when you deploy.

## STEP 2 — Install app files
- **Changed:** components/nav.ts (nav now centres on Monthly reporting).
- **New:** lib/monthly.ts, app/(dashboard)/monthly/*.
- No new npm dependencies. Copy in, replace nav.ts, then:
  ```
  npm install
  npm run dev
  ```

## What you get now
- Sidebar -> **Monthly reporting -> Enter monthly report**.
- Pick a lodge + month. Fill the sections (all fields taken from your Manager's
  Report sheet: front office, F&B, misc, housekeeping, energy, vehicles, servicing,
  staff, sustainability/TDS, safari, tickets, accounts, guest experiences).
- **Save draft** (edit freely) or **Submit**. After submit, a manager sees the report
  read-only ("Submitted and locked"). A **super admin** can **Reopen** or **Delete**,
  and can edit any lodge's report anytime.
- Managers only see their own lodge (enforced by row-level security).

## Still coming (next steps)
- Load your 4 real PDF reports (Pench Oct/Nov, Waghoba Oct/Nov) as data.
- Manager dashboard (their lodge, month-over-month).
- Super-admin dashboard (all lodges side by side + trends).
- The older daily-entry pages still exist but are no longer in the sidebar; we can
  remove them entirely in a later cleanup once you're happy with the monthly flow.

## Commit (dev branch)
```
git add .
git commit -m "Monthly report system: entry form + submit-lock"
git push
```
