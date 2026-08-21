# Month/year picker fix + Pench Dec 2025–Jul 2026 data

## STEP 1 — Load Pench data (Supabase SQL)
Run **seed_pench_dec_to_jul.sql** in the SQL Editor. Loads 8 months of Pench reports
(Dec 2025 through Jul 2026), exactly as they appear in the sheets. June & July 2026
are near-empty in the source, so only the few values present are loaded. Safe to re-run.

## STEP 2 — Install the picker fix (VS Code)
- **Changed:** components/lodge-month-picker.tsx, components/month-picker.tsx.
- No new dependencies. Copy in (overwrite), then:
  ```
  npm run dev
  ```

## What changed
- The month picker no longer uses the browser's native control (which was stuck on
  one year). It's now two dropdowns — **Month** and **Year** — so you can freely pick
  any month of 2024–next year on the dashboards and the monthly report form.

## After both steps
Open the dashboard, choose different months/years, and you'll see Pench's full trend
from Oct 2025 through mid-2026, alongside Waghoba. Great for the owner's comparison view.

## Commit
```
git add .
git commit -m "Month/year picker dropdowns + Pench Dec-Jul data"
git push
```
