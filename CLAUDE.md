# CLAUDE.md - Project context for LodgeIQ

> Claude Code reads this file automatically at the start of every session.
> It is the source of truth for how this project is built. Keep it updated.

## What we're building
LodgeIQ is the internal app of **Pugdundee Safaris** (wildlife lodges in Central India).
One app, two modules:
- **Lodge Reporting**: monthly reports, occupancy, expenses, energy, vehicles, assets and
  service log, staff and payroll, bar, stock and purchases, compliance, notifications,
  trip reports. Lodges: Kings Lodge, Tree House Hideaway, Kanha Earth Lodge, Pench Tree
  Lodge, Denwa Backwater Escape, Ken River Lodge, Waghoba Eco Lodge (more later).
- **Sales & Itinerary**: enquiry -> itinerary builder (chat assistant) -> pricing ->
  guest itinerary page + PDF -> status (draft, open, quoted, booked, lost, cancelled).

Live at https://pugdundeesafaris.org (Vercel; the vercel.app address redirects there).
The owner is not a developer: explain in plain words, give PowerShell commands one per
block, and say what output to expect. He deploys by pushing `main`; never push for him.

## Branding (must follow)
`DESIGN_SYSTEM.md` is the source of truth for colours and components. Do not invent colours.
- Olive `#907A17` (primary), Gold `#DAB705` (accent), warm "sand" neutrals.
- Fonts: **Epilogue** (headings) + **Work Sans** (body, labels, tabular numbers), loaded in
  `app/fonts.ts`. (The typography section of DESIGN_SYSTEM.md still names Poppins/Inter:
  the code is right, that section is out of date.)
- Tailwind v4: tokens live in `app/globals.css` (`@theme`). There is no tailwind.config.js.
- Shared UI: `components/ui.tsx` (class names), `components/icons.tsx`.
- Logos in `public/`. Keep source files ASCII.

## Tech stack
- Next.js 15 App Router (React 19, server actions), TypeScript, Tailwind v4.
- Supabase: Postgres + RLS + Auth + Storage (buckets `attachments`, `sales-media`).
  `@supabase/ssr` helpers in `lib/supabase/`; the service-role client (`lib/supabase/admin.ts`)
  is server-only.
- Vercel hosting + Vercel Cron (`vercel.json`). Resend (email). Google Gemini (Sales AI
  assistant). Frankfurter/ECB (exchange rates). exceljs (Excel), jsPDF + html-to-image (PDF).

## Roles (lib/auth.ts)
- `super_admin`, `senior_manager`: both modules, admin everywhere (module picker at /hub).
- `delhi_accounts`: Lodge Reporting, all lodges.
- `lodge_manager`, `operations_manager`, `lodge_accounts`: Lodge Reporting, their lodges.
- `sales_admin`: Sales admin (Master data, members, all queries); no Lodge Reporting.
- `sales_member`: Sales, own queries only.
- `task_creator`: Trip reports only.
Access is checked on the server (every page via `requireUser()`, every server action and
API route via `getCurrentUser()`), and RLS is the real guard. Deactivated accounts
(`profiles.status` not `active`) are sent to /account-inactive and get no access.
Middleware (`middleware.ts`) only routes; it is not the security boundary.

## Sales: where things are
- Pages: `app/(dashboard)/sales/*` (dashboard, queries list and detail, `new` = builder,
  `admin` = Master data, settings, members, photos, rates export/import).
- Builder UI: `components/sales/builder/*` (trip details, chat panel, plan & price, final draft).
- Guest page: `app/i/[token]/page.tsx` (public; data from `lib/sales/client-view.ts`, which
  uses the service role and must never return costs, markup, discount or adjustment reasons,
  or internal notes). PDF: `components/sales/download-pdf.tsx`.
- Pricing: `lib/sales/pricing/engine.ts` (pure `priceTrip`), `load.ts` (reads master data),
  `tariff.ts` (Pugdundee tariff -> per-room rates), `breakdown.ts` (guest breakup),
  `health.ts` (rate data check).
- Plan: `lib/sales/plan/planner.ts` (days, safaris, closures, transfers, flights, city
  nights), `chat.ts` + `parse-text.ts` (assistant and built-in reader, incl. Hinglish),
  `ai.ts` + `app/(dashboard)/sales/new/ai-actions.ts` (Gemini), `draft.ts` (guest text),
  `sanitize.ts` (validates every plan coming from the browser).
- Master data screens: `lib/sales/master/entities.ts`; rates Excel: `rates-workbook.ts`,
  `rates-data.ts`, `slabs.ts` (payment / cancellation checks).

## Sales pricing data (Pugdundee tariff)
- `sales_tariff` (category x nationality indian/foreign/all x season all/shoulder/high/peak,
  with validity), `sales_rate_categories`, `sales_tariff_calendar` (Peak incl. long weekends
  wins over the season). Each `sales_room_categories` row points to a category.
  `sales_room_rates` = lodge exceptions and partner/city hotel rates (priority 10).
- Indian guests: published flat rates; foreign guests: seasonal rates; Ken River: B2B,
  taxes included.
- `sales_safari_rates` (park, zone, session, nationality, Tadoba booking window; weekend
  rates also on the festive dates in settings), `sales_transfer_rates` (one row per road,
  both directions, vehicle types, drive hours), `sales_addons`, `sales_offers` (incl.
  multi-lodge), `sales_settings` (payment / cancellation slabs, FX, yearly hike, AI switch,
  contacts).
- Yearly hike: a date with no rate but covered by the hike period uses last year's rate +
  the hike % (rooms, safaris, transfers); add-ons get the % on dates in the hike period.
- City / partner hotels (kind `city_hotel` / `partner_lodge`) are not "our lodges": no
  multi-lodge offer, no lodge discount, no automatic safaris.
- Prices are always recalculated on the server when a quote is saved; never trust the
  browser's numbers.
- Master data is cached for the builder (`loadBuilderContext`, unstable_cache, tag
  `sales-master`, 5 min): any new code that saves master data must call
  `revalidateMasterData()` (`lib/sales/master/cache.ts`).
- Missing transfer rates: Master data > Missing transfer rates (`lib/sales/master/missing-transfers.ts`),
  Excel out and back in through Import rates. A transfer price typed on Plan & price can be
  saved as the rate (admins) or sent as a suggestion (`sales_rate_suggestions`, approved in
  Master data > Rate suggestions; a trigger adds the rate).
- Saving an edited quote: a new version (new link) or an update of the current version
  (same link, audit in `sales_version_audit`; never for booked / cancelled / lost), `lib/sales/versions.ts`.
- Trip days are shown with `fmtDay` ("Sat, 16 Jan 2027").
- Server timings: `[timing]` lines in the Vercel logs (`lib/timing.ts`).

## AI assistant (Sales builder)
One reading flow (`lib/sales/plan/reading.ts`), so the reader and the AI never disagree:
1. Memory: `sales_reading_patterns` (Master data > Reading memory), saved when a quote is
   saved for the guest. The same enquiry (normalised), or the same with only dates/numbers
   changed, is read from there: no AI call.
2. The built-in reader (`parse-text.ts`) fills the trip checklist.
3. Gemini only when the checklist has gaps AND the message has words the reader could not
   place. It fills empty fields only (`fillGaps`); where it differs from the reader, the
   sales person is asked one question (the reader's value stays until answered).
The chat shows where a reading came from ("from memory", "built-in reader", "AI helped with").
Server action: `assistReading` in `app/(dashboard)/sales/new/ai-actions.ts`; model from
GEMINI_MODEL (default gemini-3.1-flash-lite), thinking off, temperature 0, 20 s, one retry on
429/503; every call logged in `sales_chat_log` (model, duration, source, gaps).
`GEMINI_API_KEY` (and optional `GEMINI_MODEL`) live in Vercel env, never in the DB; the
"AI reading" switch is in Sales settings. Before sending: `scrubForAI()` removes emails,
phone numbers and guest names (incl. the name in the guest fields). Gemini's answer is
mapped to master data (`aiToParsed`) and never trusted for prices. Timeouts stay under
Vercel's limit (page `maxDuration` 60 s).

## Database rules
- The original schema is `supabase/schema.sql`. Later changes are SQL files in `supabase/`.
- Never connect to or change the production database. Every schema/data change is a new
  SQL file that is idempotent (safe to run twice), starts with a comment block saying what
  it does, and ends with a `select` that shows the result. The owner runs it in the
  Supabase SQL Editor. If it removes something live code uses, split into "run any time"
  and "run only after the deploy is Ready".
- Do not touch `.env.local`, secrets, Vercel or Supabase settings; tell the owner instead.

## Conventions
- TypeScript everywhere; server components / server actions by default.
- Server actions return `{ error }` instead of throwing (`lib/sales/safe.ts`).
- Money: INR stored as numeric, shown in Indian style; dates ISO in DB, readable in UI.
- Validate every input on the server; no `dangerouslySetInnerHTML` with user content.
- Small, separate commits with clear messages; work on a branch, not `main`.

## Checks (run before and after every change)
```
npx tsc -p .
npm test          # every test under lib/ (node test runner via tsx)
npm run lint      # ESLint, Next.js rules
npm run build
```
Add a test for every bug fixed in `lib/sales/**`.

## Environment variables (`.env.local`, never commit)
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server
only), RESEND_API_KEY, EMAIL_FROM, CRON_SECRET, GEMINI_API_KEY, GEMINI_MODEL (optional).
