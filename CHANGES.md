# LodgeIQ — Detailed report page (read-only, every field)

A full read-only view of one lodge's monthly submission, section by section —
so super admins (any lodge) and managers (their lodge) can recheck every figure.
No database changes. Run `npm run build` (see "✓ Compiled successfully") first.

## Files
- app/(dashboard)/report-detail/page.tsx   NEW  the detail page.
- components/nav.ts                         UPDATED  adds "Detailed report" link
                                            under Monthly reporting.

## What it shows
- Every section from the monthly form (Section 1..13), driven by the same
  SECTIONS config so it can never drift from the form.
- Section 1 shown in its subsections (Accommodation / Extra sales / Feedback).
- All line-item fields + every dynamic array (energy, vehicles, servicing,
  breakdowns, staff joined/left, travel agents) as clean tables.
- Lodge + month picker at top: admins can view ANY lodge; managers see theirs
  (enforced by RLS via getAccessibleLodges).
- Export Excel + Print/Save PDF buttons.
- Clear "No monthly report submitted..." message when a month is empty.

## Note on nav.ts
This nav.ts is based on the trimmed 4-group sidebar (the simplified shell). If you
haven't installed that shell zip yet, install it first, or the nav will look
different. The "Detailed report" link itself works regardless.

## Rollback
git checkout -- components/nav.ts and delete app/(dashboard)/report-detail/
