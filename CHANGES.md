# LodgeIQ — Excel export + column toggle + de-cluttered tables

No database changes. Uses the xlsx library you already have (same as /api/report).
ALWAYS run `npm run build` and see "✓ Compiled successfully" BEFORE pushing.

## Files
- app/api/compare/route.ts           NEW  Excel export of the lodge comparison.
- lib/columns.ts                     NEW  column-group definitions (client-safe).
- components/column-toggle.tsx       NEW  the Columns: chips (show/hide groups).
- app/(dashboard)/analytics/page.tsx REBUILT  export button + toggle + lean cols.
- app/(dashboard)/dashboard/page.tsx UPDATED  toggle + lean cols on the table.
- components/charts.tsx              INCLUDED  (carries the tooltip fix so this
                                     zip can't revert it).
- lib/dashboard.ts                   INCLUDED  (perRoom + aggregate helpers).

## What changed (addresses the owner's notes)
1. EXPORT: "Export Excel" button on Compare lodges downloads the current month's
   comparison (all lodges, every metric incl. per-room) as a real .xlsx.
2. LESS DENSE: both comparison tables now start LEAN — Core + Sales + Expenses
   only. A "Columns:" chip row lets anyone switch on Per-room or Operations
   detail when they want it. Default view is much cleaner.
3. CLEARER LABELS: "Total cost" -> "Total expenses", "Extras" -> "Extra sales",
   per-room labelled "Sales/room", "Exp/room", "F&B/room".

## Column groups
- Core (always on): Lodge, Room nights, Pax
- Sales (on): Extra sales
- Expenses (on): F&B, Misc, HK, Total expenses
- Per-room (off): Sales/room, Exp/room, F&B/room
- Operations (off): F&B/guest, Energy, Safaris, Rating
The choice is saved in the URL (?cols=...), so a view can be bookmarked/shared.

## Note on the bigger "make it easy for anyone" ask
This ships the concrete wins (export, lean default, clearer labels). A broader
navigation/onboarding polish is best done next as a focused pass once you and the
owner react to this cleaner version — tell me what still feels hard to use.

## Rollback
git checkout -- "app/(dashboard)/analytics/page.tsx" "app/(dashboard)/dashboard/page.tsx" \
  components/charts.tsx lib/dashboard.ts
and delete app/api/compare/ lib/columns.ts components/column-toggle.tsx
