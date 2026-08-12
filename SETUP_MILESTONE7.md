# Milestone 7 — Reports, analytics & the last sheet sections

The final core milestone. Completes the system: every remaining spreadsheet section,
a compiled monthly report with PDF/Excel export, and a cross-lodge analytics view.

## Changed vs new files
- **Changed:** `components/nav.ts` (adds Operations log, Monthly report, Analytics).
- **New:** `lib/report.ts`, `components/month-picker.tsx`, `components/print-button.tsx`,
  `app/(dashboard)/operations-log/*`, `app/(dashboard)/reports/*`,
  `app/(dashboard)/analytics/*`, `app/api/report/route.ts`.

## New dependency
`xlsx` (Excel export) was added to package.json — run **npm install** before starting.

## What's new
### Operations log  (/operations-log)  — Operations group
The last sheet sections, per lodge + month:
- **Gypsy / safari usage**, **Ticket usage**, **Guest experiences**,
  **Accounts status (Tally)** (monthly checklist), **Stock count** (e.g. steel bottles).

### Monthly report  (/reports)  — Reports group
- A **compiled report** for a lodge + month, pulling every module together: occupancy,
  extras, ratings, F&B/misc/HK costs with cost-per-guest and per-room, energy, vehicles,
  payroll, purchases, low-stock, overdue services.
- **Workflow**: Generate → Submit → (admin) Mark reviewed.
- **Export Excel** (downloads an .xlsx) and **Print / Save PDF** (opens the browser
  print dialog with a clean, sidebar-free layout).

### Analytics  (/analytics)  — Reports group, admin/GM only
- **Cross-lodge comparison** for a chosen month: room nights, pax, extras, F&B cost,
  F&B/guest, energy, payroll, and overdue services — every lodge side by side, with
  overdue counts flagged in red.

## Install
1. Unzip, copy into your repo root (keep structure), replace `nav.ts` when asked.
2. Install the new dependency and run:
   ```
   npm install
   npm run dev
   ```

## Try it
- **Operations log**: add a safari day, a ticket day, tick the Tally checklist, save.
- **Monthly report**: pick a lodge + month with data → click **Generate** → review the
  compiled numbers → **Export Excel** and **Print / Save PDF**.
- **Analytics**: pick a month and compare all lodges in one table.

## Commit (dev branch)
```
git add .
git commit -m "Milestone 7: reports, analytics & remaining sections"
git push
```

## That's the full core system
Every section of the original Manager's Report is now a live, multi-lodge, role-scoped
module, with alerts and reporting. Remaining roadmap (all optional/rollout):
- Deploy to production (Vercel + prod Supabase).
- WhatsApp delivery (drops into lib/notify).
- The AI assistant (chat with your live data).
- Djubo & Tally integrations.
