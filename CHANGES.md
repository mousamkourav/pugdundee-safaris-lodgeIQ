# LodgeIQ — Fix monthly report picker + readable lodge URLs (v2)

Fixes the "all zeros when picking a past month" bug and switches lodge URLs to
readable slugs. v2 fixes a build error: lodgeSlug now lives in its own file with
no server imports, so client components can use it.

## Files
- lib/lodge-slug.ts                    NEW  standalone lodgeSlug() (no server code).
- lib/lodges.ts                        re-exports lodgeSlug; resolveLodge takes id OR slug.
- components/lodge-month-picker.tsx    slugs + router.refresh(); imports lodge-slug.
- components/lodge-picker.tsx          same.

## What it fixes
- Picking a lodge/past month now reliably loads the report (router.refresh()).
- URLs read /monthly?lodge=kanha-earth-lodge&month=2026-03. Old UUID URLs still work.

## Build
npm run build  ->  "✓ Compiled successfully" before pushing.

## Rollback
git checkout -- lib/lodges.ts components/lodge-month-picker.tsx components/lodge-picker.tsx
del lib\lodge-slug.ts
