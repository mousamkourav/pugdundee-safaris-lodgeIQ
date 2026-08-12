# Milestone 1 — daily operations entry

Adds four modules to the app you already have running:

- **Occupancy & extras** — daily rooms (paid/comp) + pax; extra sales (activities,
  beverages, food, transport…). One row per lodge per day. Room-nights, pax and
  extra-sales totals for the month.
- **Expenses** — F&B / Misc / Housekeeping line items. Shows category totals and,
  when occupancy exists for the month, **F&B cost per guest and per room**.
- **Energy** — DG sets, electricity, solar. Net usage auto-calculates (closing −
  opening). Monthly cost and fuel totals.
- **Vehicles** — add vehicles, then log daily runs. Run-km comes from the DB;
  **₹/km** is calculated per log.

Every screen has a **lodge + month picker** at the top. Data is daily and rolls up to
the month you select. Resort managers only see their own lodge (enforced by the
database). All money is INR.

## Install
1. **Unzip** and copy the files into your repo root
   `pugdundee-safaris-lodgeIQ/`, keeping the folder structure. It only adds new
   files and updates `components/nav.ts`. Overwrite when your file manager asks —
   the only replaced file is `nav.ts` (now includes the four new links).
2. No new dependencies. From your project:
   ```
   npm run dev
   ```
3. Open http://localhost:3000. You'll see Occupancy, Expenses, Energy, Vehicles
   under "Operations" in the sidebar.

## Try it
- Go to **Occupancy**, pick your lodge, add a day or two, add an extra sale.
- Go to **Expenses**, add an F&B item — with occupancy entered, you'll see cost
  per guest and per room.
- **Vehicles**: add a vehicle, then log a run to see ₹/km.

## Commit (on the dev branch)
```
git add .
git commit -m "Milestone 1: occupancy, expenses, energy, vehicles"
git push
```

## Next
Milestone 2 — Assets & service log (with the overdue/due-soon panel that powers the
expiry notifications).
