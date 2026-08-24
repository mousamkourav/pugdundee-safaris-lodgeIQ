# LodgeIQ — Fix: Monthly summary now reads your real data

The Monthly summary page (/reports) was reading empty relational tables (a
dormant second data system), which is why it showed all ₹0 and "Not generated".
It now reads the SAME monthly_submissions JSONB as the dashboard, so it shows
figures consistent with everything else. No database changes. Run `npm run build`
(see "✓ Compiled successfully") before pushing.

## Files
- lib/report-summary.ts               NEW  reads monthly_submissions -> summary.
- app/(dashboard)/reports/page.tsx     REWRITTEN  uses it; drops the old
                                       Generate/Submit/Refresh workflow (that
                                       belonged to the empty relational system).

## What changed
- Monthly summary shows Occupancy & revenue, Costs, Energy & vehicles, and Safaris
  straight from the submitted monthly report — same numbers as the dashboard.
- Export Excel and Print/Save PDF still work.
- If a lodge/month has no submission, it shows a clear "No monthly report
  submitted..." message instead of a wall of zeros.
- The old lib/report.ts and reports/actions.ts are no longer used by this page
  (left in place; harmless).

## Rollback
git checkout -- "app/(dashboard)/reports/page.tsx" and delete lib/report-summary.ts
