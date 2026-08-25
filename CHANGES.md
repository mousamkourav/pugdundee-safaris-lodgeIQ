# LodgeIQ — Compliance feature (insurances & licences)

New feature to track licenses, insurances, AMCs, and fitness/pollution certs per
lodge, with expiry status badges. Two parts: SQL (run in Supabase) + app code.

## STEP 1 — Supabase (run in this order)
1. compliance_schema.sql   creates the compliance_documents table + RLS.
2. seed_compliance.sql      loads 124 documents across all 6 lodges from your CSV.
(Both are in the outputs alongside this zip. seed is idempotent per lodge.)

## STEP 2 — App code (this zip)
- app/(dashboard)/compliance/page.tsx   NEW  the Insurances & licences page.
- components/nav.ts                     adds the nav link under Assets & compliance.

## The page
- Lodge picker; admins see any lodge, managers see theirs (RLS).
- Documents grouped by category (License / Insurance / AMC / Fitness / Pollution).
- Status badge per row: Expired (red), <30d / <90d left (red/amber), Valid (green).
- Summary chips at top: "N expired", "N expiring within 30 days".
- Sorted so the most urgent items surface first.

## Notes
- Some documents have no dates in the CSV (e.g. Medical Insurance "All to take
  Govt", Fire NOC "pending") — shown with a neutral "No date" badge, remarks kept.
- Dates were normalised from mixed formats (dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy).

## Build
npm run build  (must say "✓ Compiled successfully" before pushing)

## Rollback
git checkout -- components/nav.ts and delete app/(dashboard)/compliance/
