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
- Outstation car packages (`sales_car_packages`, Master data > Outstation car packages,
  `lib/sales/plan/car-packages.ts`): one price for the car over a road trip from a city and back
  (Delhi - Agra - Jaipur - Delhi, 4 nights). When the trip's drives make exactly that trip (same
  cities in order, nights between leaving and coming back), the package is one item and those
  drives are not priced (`CityTransfer.package_id`, engine `car_packages`); city sightseeing on
  the way is by the package's car. No exact package = each drive priced on its own, with a note.
- Missing transfer rates: Master data > Missing transfer rates (`lib/sales/master/missing-transfers.ts`),
  Excel out and back in through Import rates. A transfer price typed on Plan & price can be
  saved as the rate (admins) or sent as a suggestion (`sales_rate_suggestions`, approved in
  Master data > Rate suggestions; a trigger adds the rate).
- Saving an edited quote: a new version (new link) or an update of the current version
  (same link, audit in `sales_version_audit`; never for booked / cancelled / lost), `lib/sales/versions.ts`.
- Trip days are shown with `fmtDay` ("Sat, 16 Jan 2027").
- Server timings: `[timing]` lines in the Vercel logs (`lib/timing.ts`).

## AI assistant (Sales builder)
One reading flow, AI first (`lib/sales/plan/reading.ts`):
1. Memory: `sales_reading_patterns` (Master data > Reading memory), saved when a quote is
   saved for the guest. The same enquiry (normalised), or the same with only dates/numbers
   changed, is read from there: no AI call.
2. Gemini, for every chat message (`assistReading`), except a short reply to the assistant's
   own question (`isShortAnswer`: "cottage", "same", "7 and 12"), which the reader reads.
   Evidence rule (`lib/sales/plan/evidence.ts`, `checkEvidence`, on the server): every value
   comes as `{ value, quote }`; it is kept only when the quote is in the message
   (case-insensitive, small typos, numbers exact, not across a comma) and states that value
   (the nights, the ages, the lodge's name...). No valid quote = dropped, never guessed. Then
   `aiToParsed` checks names against Master data (unknown ones are dropped and asked).
3. The built-in reader (`parse-text.ts`): the backup. It reads alone when the AI is off,
   fails, times out or has no credit; otherwise it fills only what the AI left empty
   (`mergeAiFirst`), never overriding a value the AI quoted. Where the two read different nights
   for the same stop, one question is asked ("Kanha: 3 or 4 nights?"; owner, 3 Nov 2026).
Accuracy first (3 Nov 2026):
- Nothing dropped silently (`lib/sales/plan/unread.ts`, `unreadParts`): every place and every "N
  nights / N days" of the enquiry (`plan.enquiry`, the trip's messages as written; `ParsedTrip.mentions`)
  must be in the trip; what is not is listed in red on the Confirm step and said in the chat.
- The AI's form covers the whole trip: `dateless`, `breaks`, `end_city`, `trip_wide` (wishes for
  every stop), two lodges in one park, every place and night (each through the evidence rule).
- A long enquiry (250+ characters) is read by `GEMINI_MODEL_LONG` (default gemini-2.5-pro, thinking
  on, 40 s); if Google does not know it, by `GEMINI_MODEL`.
- `enquiry-corpus.ts`: every real enquiry so far; `unread.test.ts` checks each on the real Master
  data (nothing unread, no impossible road). Add every new enquiry there.
The chat shows where a reading came from ("from memory", "read by the AI; the built-in reader
added: ...", "built-in reader"). `enquiries.test.ts` checks every enquiry with a worst-case
Gemini too (invented quotes, an empty answer): the trip must not change.

Route rules (do not patch phrases around them):
- `lib/sales/plan/route.ts` (`resolveRoute`): the places in the order written (city nights and
  lodges); two in a row that no road joins (different road regions, `roadRegions`) are joined by
  a flight, written or not. A lodge's airport: named in the text for that leg, else the airport
  with a road to it in Master data (shortest drive; several = one question, `airport:<park>`).
  Arrival / departure = the airports of the flights into the first and out of the last lodge.
- `noDriveBetweenRegions` (planner) / `noRoad`: the last guard. A road transfer with a lodge at
  one end between two regions (Tadoba - Kaziranga, Delhi - Iora Retreat) is never planned,
  whatever the reader or the AI gave; the day gets a note instead. Between two city places (Agra
  hotel - Delhi airport) a missing road is a price to type, not a guard.
- From one city stay to the next by a connecting flight ("transfer to Khajuraho for the Delhi
  flight, drive direct to Agra"): hotel > airport, the flight, the drive from that airport.
- Places are linked by Master data, never by name alone (2 Nov 2026): a city's airport is the one
  named after it OR the one with a road to its hotel (`airportServes`: Bagdogra for Siliguri);
  flights go on the day of the stay they leave from / land at (a city stay first, then the lodge
  its airport serves). Two city stays are joined by road only with a rate between their hotels or
  a `DRIVE_CITIES` pair (Delhi - Agra - Jaipur...); otherwise the day says "No road between ...:
  add the flight" and the hard checks stop the quote.
- Experiences: the reader knows `EXTRA_WORDS` AND each add-on by the word only it has in Master
  data (`addonTriggers`: Tawa, Moharli, Enfield, Gypsy, Scorpio, Banjar; "via X" for a road's extra),
  never by common words (lunch, safari, walk), so a new add-on is read without a code change. With
  AI reading on, the AI's keywords and the reader's add-on names are merged (the specific one wins). A lodge experience the lodge
  does not sell (no active add-on there) is left out with a day note "X is not offered at Lodge
  (offered at ...)" (`notOfferedNote`), never a "price needed". A city wish with no add-on (Agra
  sightseeing) is an item "price needed" (engine `custom_items` amount null, missing kind
  "extra"), never a silent 0. A stay's experiences are spread over its days.
  "N buffer safaris" (`want_buffer`), "2 gaadi for all transfers" (`transfer_vehicles`).
- Master data > Rate coverage (`lib/sales/master/coverage.ts`) prices every case with the engine
  (rooms by month, child, safaris, full day, naturalist, experiences understood with no add-on);
  `real-circuit.test.ts` runs the owner's whole-circuit enquiry on his REAL Master data
  (`real-master.data.ts`, generated from his export of 2 Nov 2026; `real-fixture.ts` = `realCtx`).
  Test reading and routing on real data, never only on made-up rows; regenerate it from a new export.
- A break from our itinerary ("they go to another resort for 2 days and resume with us", "2 nights
  at another resort", "not with us for 3 nights", "take a break of 2 days"): the reader adds a
  city stay `{ city: "", away: true, blank: true, at }` between the lodges (parse-text, `BREAK_RE`;
  the AI's city nights never drop it, `mergeAiFirst`). Days "Own arrangements", nothing priced;
  `away_transfer` "own" (default: no transfers, no "no way in / out" check) or "ours" (our car to
  "@their own hotel" and back, prices typed), set on the Confirm step. Guest: exclusion line.
- Long free-text enquiries (owner's USA group, 3 Nov 2026, `big-enquiry.test.ts`): city names are
  spelling-corrected ("khazuraho"); "three house" = tree house; "4 nights 2 nights kings 2 nights
  tree house" = the split; "N nights there" / "stay one night there" (a city they leave "from" is
  never "there"); "agra and jaipur for 4 days" = 3 nights split (said in a note); "back to Delhi
  ... fly to USA" ends at Delhi; "go to X from Y airport" is a flight. A wish written once for the
  whole trip ("all the unique experience that we offer like cycling, walking", "safaris with
  naturalists") goes to every lodge (`tripExtras`). Dates not fixed: `DATELESS_RE` in chat.ts.
- Two cities Master data shows apart (Khajuraho > Delhi) are a flight unless a road trip pair
  (`DRIVE_CITIES`) or a flight written out of the first city (route.ts). The way in / out is a flight
  whose airport reaches the first / last lodge (`airportReachesLodge`).
- Flights: each leaves from the last stay its airport serves before the place it lands; two
  lodges in different regions joined by a flight get the drives to and from the airports (no "far
  apart" question); a city's flight that does not reach the next lodge is not its way in
  (`airportReachesLodge`).
- City nights with no hotel named take the city's hotel from Master data (Roseate House for
  Delhi); "hotel in X" (none yet) gets no transfer price box.
- Misspelt trip words ("nigths", "safaries", "adluts") are read (`fixTripWords`).
- Travel days are shown in time order (`day-order.ts`): to the airport, flight, from the
  airport, safaris.
Every enquiry the team reports becomes a test (`enquiries.test.ts`, `multi-region.test.ts`).

Quotes safe even when the reader misreads (builder steps: Trip, Confirm, Plan & price, Final draft):
- Confirm step (`lib/sales/plan/confirm.ts`, `components/sales/builder/confirm-step.tsx`): the
  trip in plain words, in order (`tripSummary`), with one-click corrections (`editStop`,
  `editStay`, `removeFlight`). "Correct, continue" sets `plan.confirmed.key = confirmKey(plan)` (r2: made from
  `sanitizePlan(plan)` with keys sorted, so the browser and the server always agree; r1 keys of
  older quotes still accepted);
  Plan & price opens only while the route is unchanged. Quotes saved before the step existed
  count as confirmed when opened. Corrections teach the reader at once
  (`learnFromConfirmation`: Reading memory + suggested reader rules).
- Hard checks before saving for the guest (`lib/sales/plan/checks.ts`, `quoteChecks`), in the
  browser and again in `saveItinerary`: confirmed route, complete stops, continuous days, no
  road between regions, a way in and out of every lodge (a transfer or their own vehicle),
  every price from Master data or typed. A draft can always be saved.
- "Build with a form" on the Trip step (`lib/sales/plan/form.ts`, `trip-form.tsx`): stops,
  city nights and flights added one by one, no reading involved; checked on Confirm like any trip.
Server action: `assistReading` in `app/(dashboard)/sales/new/ai-actions.ts`; model from
GEMINI_MODEL (default gemini-3.1-flash-lite), thinking off, temperature 0, 20 s, one retry on
429/503; every call logged in `sales_chat_log` (model, duration, source; the "gaps" column lists
the AI values the evidence rule dropped, "field: reason").
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
only), RESEND_API_KEY, EMAIL_FROM, CRON_SECRET, GEMINI_API_KEY, GEMINI_MODEL (optional), GEMINI_MODEL_LONG
(optional; long enquiries).
