# LodgeIQ — Editable Insurances & Licences

The compliance page is now fully editable: add new documents, edit any field
inline, delete. Permissions handled by existing RLS (admins + the lodge's own
manager via has_lodge_access). No database changes.

## Files (overwrite existing)
- app/(dashboard)/compliance/page.tsx    add form + per-row edit/delete + status badges.
- app/(dashboard)/compliance/actions.ts  NEW  addDoc / updateDoc / deleteDoc.

## Notes
- Category (License/Insurance/AMC/Fitness/Pollution/Other) is stored as a
  [Category] prefix in notes; doc_type maps to insurance|licence (the DB constraint).
- Blank expiry stored as 2099-12-31 (NOT NULL column) and shown as "No expiry".
- Existing seeded documents keep working; their [Category] prefixes are read back
  into the category dropdown.

## Build
npm run build -> "✓ Compiled successfully"
