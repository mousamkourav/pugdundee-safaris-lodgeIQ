# Dashboards + fresh start

## Order of operations
1. **Cleanup (optional, for a fresh demo):** in Supabase SQL Editor run
   **cleanup_fresh_start.sql** — wipes all operational data & notifications but keeps
   lodges + users.
2. **Re-seed:** run **seed_monthly_reports.sql** — reloads the 4 real monthly reports
   (Pench + Waghoba, Oct + Nov 2025).
3. **App:** copy these files in (replace when asked), then:
   ```
   npm install
   npm run dev
   ```

## App files
- **Changed:** app/(dashboard)/dashboard/page.tsx, app/(dashboard)/analytics/page.tsx.
- **New:** lib/dashboard.ts, components/charts.tsx, components/month-select.tsx.
- **New dependency:** `recharts` (charts). `npm install` pulls it in.

## What you get
- **Owner dashboard** (super admin / GM): a month selector; KPIs for the month; bar
  charts (extra sales by lodge, F&B cost per guest); trend lines (extra sales, room
  nights) across months per lodge; and a full **lodge comparison table**.
- **Manager dashboard**: their own lodge — KPIs, extra-sales and cost trends over
  months, and a monthly figures table. (Managers only see their lodge.)
- **Compare lodges** page: side-by-side table + bar charts for a chosen month.

All of it reads the **monthly reports**, so it fills in as soon as the seed is loaded
or managers submit data.

## Commit
```
git add .
git commit -m "Dashboards (charts + comparison + month filter) on monthly data"
git push
```
