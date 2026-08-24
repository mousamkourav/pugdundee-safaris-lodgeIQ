# LodgeIQ — Section 1 subsections + per-room reporting

No database changes. Install via Expand-Archive, then ALWAYS run `npm run build`
locally and confirm "✓ Compiled successfully" BEFORE pushing.

## Files (8)
- lib/monthly.ts                              Section 1 split into 3 subsections;
                                              total_rooms now auto (paid+comp).
- components/monthly-form.tsx                 renders subsection headings.
- lib/dashboard.ts                            adds perRoom() helper (+ earlier
                                              aggregateByLodge, kept).
- lib/ranges.ts                               (calendar presets, unchanged).
- components/charts.tsx                        (donut, unchanged).
- components/range-select.tsx                  (unchanged).
- app/(dashboard)/dashboard/page.tsx          per-room bars + table columns.
- app/(dashboard)/analytics/page.tsx          per-room bars + table columns.

## Section 1 — now three subsections
(a) Accommodation: Paid rooms, Comp rooms, Total rooms (AUTO = paid+comp),
    Adults, Children 5-12, Total pax (AUTO).
(b) Extra sales: Nature shop, Alcohol, Soft drinks, Corkage, Laundry billed,
    Extra food, Extra activities, Transport, Total extra sales (AUTO),
    Per-room avg extra sale (AUTO).
(c) Feedback: TripAdvisor rating/positive/poor, Google rating/positive/poor.

Total rooms is now computed, so managers can't mistype it — it always equals
paid + comp.

## Per-room reporting (Dashboard + Compare lodges)
Because lodges have different room counts, absolute totals mislead. Added:
- Charts: "Extra sales per room" and "Total expenses per room" by lodge.
- Table columns: Extras/room, Total exp, Exp/room, F&B/room, HK/room, Misc/room.
- All computed as value / room-nights (guards divide-by-zero). On the dashboard
  these respect the calendar-range aggregation (sum ÷ sum room-nights).

## IMPORTANT — build locally first
Run `npm run build`. Only push if it says "✓ Compiled successfully". This avoids
the failed Vercel deploys from before.

## Rollback
git checkout -- lib/monthly.ts components/monthly-form.tsx lib/dashboard.ts \
  "app/(dashboard)/dashboard/page.tsx" "app/(dashboard)/analytics/page.tsx"
