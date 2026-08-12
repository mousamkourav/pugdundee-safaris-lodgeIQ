# LodgeIQ — Build Guide (solo + Claude Code)

This is your hands-on playbook. Work **top to bottom**. Each milestone has a prompt
you paste into Claude Code. Build one module at a time, verify it works, commit, move on.

---

## Part A — One-time setup (before any coding)

### 1. Create accounts
- **Supabase** (supabase.com) → new project (choose a region near India, e.g. Mumbai/Singapore). Save the project URL, anon key, and service-role key.
- **Vercel** (vercel.com) — you'll connect the GitHub repo later.
- **Resend** (resend.com) — for email. Get an API key.
- **WhatsApp** — pick a provider later (AiSensy / Interakt / Gupshup / Meta Cloud API). Not needed until Milestone 6.

### 2. Apply the database schema
In Supabase → **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
Then → **Storage → Create bucket** named `attachments`, set to **Private**.
Then create your own admin login: **Authentication → Users → Add user** (email + password).
Finally, in **SQL Editor**, promote yourself to super admin:
```sql
update public.profiles set role = 'super_admin', full_name = 'Your Name'
where id = (select id from auth.users where email = 'you@example.com');
```

### 3. Install tools on your computer
- Install **Node.js 20+** and **Git**.
- Install **Claude Code** (see the Anthropic docs) and sign in.
- Create a folder `lodgeiq/`, copy `CLAUDE.md`, `DESIGN_SYSTEM.md`, the `supabase/` folder, and the `public/` folder (with the two Pugdundee logos) into it, and open the folder in Claude Code.

---

## Part B — How to work with Claude Code (read once)
- **Build one milestone per session.** Don't ask for the whole app at once — quality drops and context fills up.
- **Let it read `CLAUDE.md` and `supabase/schema.sql` first.** They keep it aligned.
- After each feature: **run it locally, click through it, then commit** (`git commit`) before the next.
- If it drifts, say "re-read CLAUDE.md and the schema, then continue."
- Keep secrets in `.env.local` (Claude Code can create the file; you paste the real values).
- Use `/clear` between milestones to reset context; the files keep the knowledge.

---

## Part C — Milestones (paste each prompt into Claude Code)

### Milestone 0 — Scaffold + Brand + Auth + Roles + Add-Lodge
> Read CLAUDE.md, DESIGN_SYSTEM.md, and supabase/schema.sql. Scaffold a Next.js (App Router,
> TypeScript, Tailwind) app in this folder. **First set up the brand:** add the olive/gold/sand
> tokens and semantic roles to app/globals.css exactly as in DESIGN_SYSTEM.md, load Poppins +
> Inter via next/font, set the favicon to public/pugdundee-logo-circle.jpeg, and build a branded
> login page and sidebar using public/pugdundee-logo-horizontal.jpeg. Then add @supabase/ssr with
> server and client helpers, login, protected routes, and sign-out. Generate DB types from Supabase.
> Build the app shell: role-aware left nav grouped Operations / Staff / Inventory /
> Reports / Admin, and a role-aware dashboard landing page. Then build the **Lodges**
> module (list, add-lodge form, edit) and a **Users & Access** admin page (invite user,
> set role, assign lodges) — visible only to super_admin and general_manager, and
> enforcing that only a super_admin can create/modify a super_admin. Use reusable
> <PageHeader>, <DataTable>, <EntryForm>, <KpiCard> components. Give me setup/run steps.

*Verify:* you can log in, see the dashboard, add a lodge, invite a resort manager, and that manager sees only their lodge.

### Milestone 1 — Core daily operations entry
> Re-read CLAUDE.md and schema. Build these lodge-scoped daily-entry modules, each with
> list + create + edit + zod validation + auto-calculated summaries: **Occupancy**
> (occupancy_daily + extra_sales + ratings + travel_agents), **Expenses** (F&B / Misc /
> Housekeeping tabs from the `expenses` table, showing per-pax and per-room cost),
> **Energy** (energy_readings), **Vehicles** (vehicles + vehicle_logs with per-km).
> Add each as a KPI block on the lodge dashboard. Reuse the shared components.

### Milestone 2 — Assets & service log
> Build the **Assets & Service Log** module: manage assets (with criticality and
> service interval), record services (next_due auto-set by the DB trigger), and show a
> "Due soon / Overdue" panel driven by the v_service_due view, safety items first.

### Milestone 3 — Staff + Full Payroll
> Build **Staff** (add, edit, mark left with reason), **Attendance** (monthly grid:
> present/absent/paid_leave/unpaid_leave/half_day/week_off), **Advances**, and a
> **Payroll run** per month that pulls attendance + base salary + advances into the
> `payroll` table and shows gross/net (net is a generated column). Allow marking paid
> and attaching a payslip. Validate everything with zod.

### Milestone 4 — Bar / Liquor
> Build the **Bar** module: bar_items (stock + rate + reorder level), stock movements,
> and rate editing. Editing a rate must update current_rate (the DB trigger logs history
> and creates a notification). Show rate-change history per item and a low-stock flag.

### Milestone 5 — Stock & Purchases (with bill upload)
> Build **Stock** (stock_items with reorder level) and **Purchases** (item, qty, rate,
> auto amount, vendor, date) with **bill file upload to the Supabase `attachments`
> bucket**, linked via bill_attachment_id. Show a purchases list with a link to view each bill.

### Milestone 6 — Notifications (email + WhatsApp)
> Build the **Notifications** system: an in-app inbox reading the notifications table,
> a rules config page (notification_rules), a Vercel Cron route (protected by CRON_SECRET)
> that daily scans v_service_due and report submission status and inserts notifications,
> and delivery via **Resend (email)** and a **WhatsApp** send function (stub the provider
> call behind an interface so I can plug in AiSensy/Interakt/Gupshup later). Mark
> notifications sent/failed. Bar rate-change notifications already exist from the DB trigger —
> make sure they get delivered too.

### Milestone 7 — Reports & Analytics
> Build **Monthly Reports**: generate a per-lodge monthly report from all module data
> (draft → submitted → reviewed workflow), export to PDF and Excel. Build **Analytics**:
> a per-lodge dashboard (occupancy, extras mix, cost structure, energy/fuel, ratings,
> staff cost, overdue services) and a cross-lodge comparison for super_admin/general_manager,
> using the v_monthly_* views and Tremor/Recharts.

### Milestone 8 — Remaining sections + polish
> Build **Safari usage**, **Ticket usage**, **Guest experiences**, **Accounts status**
> (Tally reconciliation flags), and **Simple stock** (steel bottles). Then a polish pass:
> consistent empty states, tooltips, loading and error states, mobile responsiveness,
> and an audit_log write on important changes.

---

## Part D — Deploy
> Push the repo to GitHub, connect it to Vercel, add all environment variables in the
> Vercel dashboard, set up the Cron job in vercel.json, and deploy. Give me the exact steps.

---

## Part E — Later (after the core is live)
- **AI assistant**: a chat panel that queries the live DB (via the Anthropic API / MCP) for
  natural-language analysis across lodges and months.
- **Integrations**: pull Occupancy from the **Djubo API**; reconcile Accounts with **Tally**.
- **More roles**: department_head, accounts, viewer (already allowed by the schema).
- **Offline capture** for low-connectivity lodges; optional **native mobile app**.

---

## Cheat sheet — verify RLS is working
Log in as a resort manager for Lodge A and confirm you **cannot** see Lodge B's data
anywhere (lists, dashboards, or by editing a URL). If you can, the RLS policy or the
lodge_id filter is wrong — fix before continuing.
