# Milestone 2 — Assets & service log

Adds the **Assets & service** module — the foundation for your service-expiry alerts.

## What it does
- **Manage assets** per lodge: name, category, criticality (Safety / Normal), and a
  service interval in months (e.g. Fire Extinguisher = 12, DG set = 6).
- **Record a service** for an asset. The next-due date is filled automatically by the
  database from the asset's interval — you never calculate it.
- **Service status panel** at the top: every asset with its last service, next due,
  days remaining, and a status badge — **Overdue**, **Due soon (≤30 days)**, **OK**,
  **No service**, or **Tracked**. Sorted so problems surface first, with **safety
  items prioritised**.
- KPIs: how many assets are Overdue, Due soon, and total tracked.

This is exactly the logic that will drive the WhatsApp/email alerts in Milestone 6 —
fire extinguisher, pool filter, DG sets, RO filters, tank cleaning, etc.

## Install
1. **Unzip** and copy the contents into your repo root, keeping structure.
   Only one existing file is replaced: `components/nav.ts` (adds the "Assets &
   service" link). Everything else is new.
2. No new dependencies. Run:
   ```
   npm run dev
   ```
3. Open http://localhost:3000 → "Assets & service" under Operations.

## Try it (recreate the real example from your report)
- Add asset **Fire Extinguisher**, criticality **Safety**, interval **12**.
- Record a service dated last year (e.g. 2024-09-01).
- It will show as **Overdue** in red at the top — just like your October report flagged.
- Add **Pool filter** (Safety, 12) and a **DG 125 KVA** (Normal, 6) to see the panel fill.

## Commit (dev branch)
```
git add .
git commit -m "Milestone 2: assets & service log"
git push
```

## Next
Milestone 3 — Staff + full payroll (staff, attendance, advances, monthly payroll run).
