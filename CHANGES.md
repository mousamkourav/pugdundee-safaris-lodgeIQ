# LodgeIQ — Task 4: Revenue-share donut (headline) + Task 3 calendar presets

This zip is self-contained: it includes Task 3 (calendar presets) AND Task 4
(the donut), so you only install ONE dashboard file. No database changes.
Install via Expand-Archive, then npm run dev.

## Files (5)
- components/charts.tsx                      UPDATED  adds DonutShare (keeps
                                             BarCompare + LineTrend unchanged).
- app/(dashboard)/dashboard/page.tsx         REWRITTEN  headline donut + range
                                             presets + "Management Dashboard".
- lib/ranges.ts                              NEW   range preset helpers.
- lib/dashboard.ts                           UPDATED  aggregateByLodge().
- components/range-select.tsx                NEW   the date-range dropdown.

## The donut
- Sits at the TOP of the Management Dashboard as the headline visual.
- Title "Revenue share by lodge", subtitle "Extra sales · <range>" — labelled so
  it's clearly extra-sales share, not literal total revenue.
- Donut + a legend list showing each lodge's %; tooltip shows ₹ and %.
- Respects the calendar-range filter (aggregates extras across the range).
- Shows "No data for this range" cleanly when the window is empty.

## Everything from Task 3 is included
- Date-range presets: This month / Last 3 / 6 / 12 / 24 months / Custom.
- KPIs, bars, comparison table aggregate across the range; averages recomputed.
- "Management Dashboard" title.

## If you already installed Task 3
That's fine — just install this; it overwrites the same files with the
donut-included versions. Nothing else in the app is affected.

## Rollback
git checkout -- components/charts.tsx "app/(dashboard)/dashboard/page.tsx" \
  lib/dashboard.ts && del lib\ranges.ts components\range-select.tsx
