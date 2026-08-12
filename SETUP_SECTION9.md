# Section 9 add-on — Sustainability & photos + Travel agents

Closes the last gaps from the paper report: TDS water readings, equipment breakdowns,
site photos, and the travel-agents screen.

## STEP 1 — Run the database add-on (Supabase, required first)
The Sustainability module uses two new tables. In Supabase -> SQL Editor, run
**schema_section9.sql** (provided separately). You want "Success. No rows returned".
Do this BEFORE using the module, or the page will error (tables won't exist yet).
Remember to run it on the PROD project too when you deploy.

## STEP 2 — Install the app files
- **Changed:** `components/nav.ts` (adds "Travel agents" and "Sustainability").
- **New:** `app/(dashboard)/sustainability/*`, `app/(dashboard)/travel-agents/*`.
- No new npm dependencies. Copy in, replace nav.ts, then:
  ```
  npm run dev
  ```

## STEP 3 (optional) — Refresh the Waghoba demo
Re-run **seed_waghoba_oct2025.sql** (updated) to add sample TDS readings and travel
agents to Waghoba's October. Safe to re-run.

## What's new
- **Sustainability & photos** (Operations group): water TDS readings (refilling station
  + kitchen), equipment breakdowns with Open/Resolved, and photo uploads (Pool, Kitchen,
  Kitchen Garden, Microgreens, Compost, TDS shots) to Supabase Storage — replacing the
  WhatsApp photo habit. Photos show as a gallery with delete.
- **Travel agents** (Operations group): record agencies that visited, with contact and date.

## Note on photos
Photo upload uses the same private `attachments` bucket and storage policies you already
added. Files are stored under `{lodge_id}/sustainability/...` and shown via time-limited
signed URLs.

## Commit (dev branch)
```
git add .
git commit -m "Section 9: sustainability, photos, TDS, breakdowns + travel agents"
git push
```
