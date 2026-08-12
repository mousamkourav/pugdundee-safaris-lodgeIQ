# CLAUDE.md — Project context for LodgeIQ

> Claude Code reads this file automatically at the start of every session.
> It is the source of truth for how this project is built. Keep it updated.

## What we're building
LodgeIQ is a multi-lodge **operations, reporting & notification system** built **under the
Pugdundee Safaris umbrella** (an internal product for the company's wildlife lodges —
currently 7: Kings Lodge, Tree House Hideaway, Kanha Earth Lodge, Pench Tree Lodge, Denwa
Backwater Escape, Ken River Lodge, Waghoba Eco Lodge; more later). It replaces a manual
monthly Excel "Manager's Report" with structured data entry, dashboards, notifications, and
(later) an AI assistant. **AI is out of scope for now** — build the core system first.

## Branding (must follow)
This app must look like part of the Pugdundee Safaris brand. **`DESIGN_SYSTEM.md` is the
source of truth for all visuals — read it before building any UI.** Do not invent colours.
- Brand colours (from the logo): **Olive `#907A17` (primary)**, **Gold `#DAB705` (accent)**, warm "sand" neutrals.
- Fonts: **Poppins** (headings) + **Inter** (body/tables/numbers) via `next/font`. The logo wordmark is an image — don't reproduce its handwriting font in the UI.
- Logos are in `public/`: `pugdundee-logo-horizontal.jpeg` (sidebar top + login), `pugdundee-logo-circle.jpeg` (favicon + avatar).
- Present the product as Pugdundee's: show the logo in the header/sidebar and a "by Pugdundee Safaris" lockup.
- Apply the palette, typography, and component rules from DESIGN_SYSTEM.md consistently — earthy, calm, premium; warm sand backgrounds, olive for actions, gold for small accents.

## Tech stack (do not deviate without updating this file)
- **Next.js (App Router, TypeScript)** — UI + API routes/server actions. No separate backend.
- **Supabase** — Postgres DB, Auth, Storage, Row-Level Security. Data lives in Supabase cloud.
- **Vercel** — hosting.
- **Tailwind CSS** + **Tremor** (dashboards) + **Recharts** (charts) + **lucide-react** (icons).
- **@supabase/ssr** for auth in the App Router (server + client helpers). Do NOT use the deprecated auth-helpers.
- **Resend** for email. **WhatsApp Business API** (provider TBD: AiSensy/Interakt/Gupshup/Meta Cloud) for WhatsApp.
- **Vercel Cron** for scheduled jobs (service-due scan, reminders).
- Exports: **SheetJS** (Excel) and **@react-pdf/renderer** or a print route (PDF).

## Data model
The full schema lives in `supabase/schema.sql` (already applied to Supabase).
Read it before writing any query. Key facts:
- Roles: `super_admin` > `general_manager` > `resort_manager` (+ future department_head/accounts/viewer).
- Access is enforced by **RLS** using helper fns `is_admin()`, `is_super_admin()`, `has_lodge_access(lodge_id)`.
- Operational data is **daily** (tables have `entry_date`) and rolls up to monthly via views/queries.
- Payroll is **full**: attendance → payroll, with advances, leaves, deductions. See `payroll` table.
- Every table has an `extra jsonb` column for future fields — use it instead of adding columns ad-hoc.

## Roles & permissions (enforce in UI *and* rely on RLS)
- **super_admin**: everything; add/remove lodges; manage all users incl. general managers.
- **general_manager**: same operational reach as super_admin across all lodges, but CANNOT create/modify/remove a super_admin.
- **resort_manager**: full data entry + dashboards for ONLY their assigned lodge(s).
- Navigation must hide modules a role can't use. Never rely on hiding alone — RLS is the real guard.

## Modules (build order in BUILD_GUIDE.md)
Lodges & users → Occupancy/extras → Expenses (F&B/Misc/Housekeeping) → Energy → Vehicles →
Assets & service log → Staff + attendance + payroll → Bar (stock/rates) → Stock & purchases (+bill upload) →
Notifications (email+WhatsApp) → Reports & analytics → Safari/Tickets/Guest-exp/Accounts → polish.

## Conventions
- **TypeScript everywhere**; generate DB types with `supabase gen types typescript`.
- Feature-based folders under `app/(dashboard)/<module>/`. Shared UI in `components/`, data access in `lib/`.
- All money is INR (₹), stored as `numeric`. Dates DD-MM-YYYY in UI, ISO in DB.
- Server-side data fetching by default (server components / server actions). Use client components only for interactivity.
- Reuse a single `<DataTable>`, `<EntryForm>`, `<KpiCard>`, `<PageHeader>` so every module looks the same.
- Validate every form with **zod** before write. Never let a divide-by-zero or blank required field save.
- Auto-calculate derived values (per-pax cost, per-km, per-hour, net salary) — users never type formulas.
- Always filter/insert with `lodge_id`; never trust the client for access — RLS enforces, but pass the right lodge.

## UX principles
Simple, clean, obvious. Dashboard-first landing per role. One clear left nav grouped as
Operations / Staff / Inventory / Reports / Admin. Mobile-responsive (no native app yet).
Empty states + tooltips so a first-time manager understands each field.

## Environment variables (in `.env.local`, never commit)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only, for cron/admin tasks
RESEND_API_KEY=
WHATSAPP_API_KEY=               # provider-specific
CRON_SECRET=                    # protects the cron route

## Definition of done for a module
1. List + create + edit + (soft) delete, all lodge-scoped.
2. zod validation + friendly errors + loading states.
3. Auto-calculated fields correct.
4. Works for all three roles with correct access.
5. Appears in nav only for permitted roles.
6. A basic KPI/summary on the dashboard.

## Guardrails
- Do not build the AI assistant yet.
- Do not add a separate Node/Express server.
- Do not store secrets client-side or bypass RLS with the service role in browser code.
- When unsure about a field, check `supabase/schema.sql` first.
