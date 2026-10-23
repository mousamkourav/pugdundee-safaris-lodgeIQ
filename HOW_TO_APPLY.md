# LodgeIQ Sales: itinerary fixes + master search (October 2026)

32 files. Folder paths are kept, so unzip at the project root (the folder with package.json).

## 1. Supabase first
Supabase > SQL Editor > New query > paste `supabase/sales_v2_itinerary_fixes.sql` > Run.
It is safe to run twice. Run it BEFORE deploying: the Add-ons form saves the new columns.

## 2. Code (VS Code terminal, at the project root)

Windows (PowerShell):
    Expand-Archive -Path .\lodgeiq-sales-v2.zip -DestinationPath . -Force

Mac / Linux:
    unzip -o lodgeiq-sales-v2.zip

Then:
    npm install
    npx tsc --noEmit
    npx tsx --test lib/sales/master/search.test.ts lib/sales/pricing/*.test.ts lib/sales/plan/*.test.ts lib/sales/*.test.ts
    git add -A
    git commit -m "feat(sales): itinerary fixes, dates not fixed, yearly hike, price breakup, master search"
    git push

Vercel deploys on the push.

## 3. In the app after deploying
- Sales settings: fill in the 2027-28 yearly hike (season name, from / to dates, % for hotels, safaris, transfers).
- Sales > Team: open each member, choose the emergency contact (or leave Automatic). Members keep their mobile up to date under My account.
- Master data: add the items listed at the end of the SQL file (Tadoba full-day safari rates, "Jeep with naturalist (without safari permit)" for the MP lodges, missing drive hours, park descriptions and wildlife photos).
