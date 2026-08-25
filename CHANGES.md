# LodgeIQ — Compliance feature (mapped to your EXISTING table)

Your database already has a compliance_documents table, so DO NOT run the schema
file. Column mapping used:
  doc_type=category, title=name, issue_date=valid_from, expiry_date=valid_to, notes=remarks

## Supabase — run ONE file only
- seed_compliance.sql   loads 124 documents (idempotent per lodge).
  (Do NOT run compliance_schema.sql — the table already exists.)

## App code (this zip)
- app/(dashboard)/compliance/page.tsx   Insurances & licences page (reads existing cols).
- components/nav.ts                      nav link under Assets & compliance.

## Page
- Grouped by doc_type; expiry badges (Expired / <30d / <90d / Valid); summary chips.
- Admins any lodge, managers theirs (RLS via has_lodge_access).

## Build
npm run build  -> "✓ Compiled successfully" before pushing.

## Rollback
git checkout -- components/nav.ts and delete app/(dashboard)/compliance/
