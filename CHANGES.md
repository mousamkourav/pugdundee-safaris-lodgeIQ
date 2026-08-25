# LodgeIQ — Short lodge codes on charts, donut & tables

Adds short codes (WEL, THH, KL, KEL, DBE, PTL) wherever lodge names render on the
dashboard and Compare lodges — chart bars, donut, and comparison tables — so the
labels stay legible. No database changes.

## Files
- lib/dashboard.ts                       adds shortCode() helper + mapping.
- app/(dashboard)/dashboard/page.tsx      uses shortCode on charts/donut/table.
- app/(dashboard)/analytics/page.tsx      uses shortCode on charts/table.

## Mapping
Waghoba Eco Lodge=WEL, Tree House Hideaway=THH, Kings Lodge=KL,
Kanha Earth Lodge=KEL, Denwa Backwater Escape=DBE, Pench Tree Lodge=PTL.
Any other lodge auto-abbreviates to its initials.

## Note
This zip also carries the export + column-toggle + per-room work (t7 base), so
installing it is consistent with everything shipped this session.

## Rollback
git checkout -- lib/dashboard.ts "app/(dashboard)/dashboard/page.tsx" "app/(dashboard)/analytics/page.tsx"
