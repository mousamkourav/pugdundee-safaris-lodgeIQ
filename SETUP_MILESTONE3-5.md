# Milestones 3–5 — Staff & payroll, Bar, Stock & purchases

Three modules in one drop. Same install pattern as before. Only one existing file is
replaced: **components/nav.ts** (adds Staff, Bar, Stock links and new nav groups).
Everything else is new.

## M3 — Staff & payroll  (/staff)
- **Staff**: add, list, mark left (with reason), delete.
- **Attendance**: mark a staff member present / absent / paid leave / unpaid leave /
  half day / week off for a date (one entry per staff per day).
- **Advances**: record cash advances per staff.
- **Payroll**: click **Generate / refresh** to pull each active staff member's base
  salary and attendance-derived day counts into a payroll row for the month. Then per
  row, enter **overtime, allowances, deductions, advance recovered** — **net pay
  calculates automatically** — and toggle **Mark paid**.

## M4 — Bar / liquor  (/bar)
- **Items**: name, category, unit, rate, stock, reorder level. Low-stock flag.
- **Update rate**: changing an item's rate **automatically logs rate history and
  creates a notification** (via the database trigger from your schema) — this is the
  "notify me when a bar rate changes" requirement, already wired.
- **Stock movements**: purchase / sale / wastage / transfer / adjustment; stock
  adjusts automatically.
- **Rate change history**: full audit of old → new rates.

## M5 — Stock & purchases  (/stock)
- **Stock items**: name, unit, current qty, reorder level. Low-stock flag.
- **Purchases**: date, tracked item (or free-text name), qty, rate (amount auto),
  vendor, and **bill upload** (image/PDF) straight to Supabase Storage. Buying a
  tracked item adds to its stock. Each bill gets a **View** link (signed, time-limited).

## Install
1. Unzip, copy contents into your repo root (keep structure). Replace `nav.ts` when asked.
2. No new dependencies. Run:
   ```
   npm run dev
   ```
3. Sidebar now shows **Staff**, and an **Inventory** group with Bar and Stock.

## One extra step for bill uploads (M5) — recommended
Bill upload works out of the box (the server uses the service-role key). To also let
the app read/write storage under normal login rules, add lodge-scoped Storage policies.
In Supabase → SQL Editor, run:

```sql
create policy "attachments read" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments'
         and public.has_lodge_access(((storage.foldername(name))[1])::uuid));
create policy "attachments write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments'
              and public.has_lodge_access(((storage.foldername(name))[1])::uuid));
create policy "attachments delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments'
         and public.has_lodge_access(((storage.foldername(name))[1])::uuid));
```
(Files are stored under `{lodge_id}/purchases/...`, so this scopes access per lodge.)

## Try it
- **Staff**: add a person with a salary, mark a few attendance days, then Generate
  payroll and watch net pay compute. Add a deduction and Save — net updates.
- **Bar**: add an item, then change its rate — check the Notifications table in
  Supabase (a `bar_rate_change` row appears) and the rate history fills in.
- **Stock**: add a purchase with a bill image, then click View to open it.

## Commit (dev branch)
```
git add .
git commit -m "Milestones 3-5: staff & payroll, bar, stock & purchases"
git push
```

## Next
Milestone 6 — Notifications engine (email + WhatsApp) for service expiry, bar rate
changes, and report reminders, plus the in-app inbox.
