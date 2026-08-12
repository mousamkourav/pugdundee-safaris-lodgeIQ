# Milestone 0 — how to run this

This folder is the Next.js scaffold: branded login, Supabase auth, role-aware
sidebar/dashboard, Lodges module, and Users & Access. Merge it into your repo,
add your keys, install, and run.

## 1. Put the files in your repo
Copy everything in this folder INTO your project root
(`pugdundee-safaris-lodgeIQ/`), keeping the structure. It is designed to sit
alongside your existing `CLAUDE.md`, `DESIGN_SYSTEM.md`, `supabase/`, and
`public/` (with the two logos) — it does not touch them.

## 2. Add your keys
Copy `.env.local.example` to `.env.local` and paste your DEV Supabase values:
```
NEXT_PUBLIC_SUPABASE_URL=...          (your dev Project URL)
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     (anon / publishable key)
SUPABASE_SERVICE_ROLE_KEY=...         (service_role / secret key)
```
`.env.local` is git-ignored — never commit it.

## 3. Install and run
```
npm install
npm run dev
```
Open http://localhost:3000 and log in with the email + password you created in
Supabase (Authentication → Users). You should land on the dashboard.

## What you can do now
- See a branded dashboard with your role.
- Lodges → Add lodge (as super admin), edit a lodge, see the list.
- Users & access → invite a user, set role, assign lodges. Only a super admin
  can create another super admin.
- Resort managers only see their assigned lodge(s) — enforced by the database
  (RLS), not just the UI.

## Generate real DB types (recommended, after it runs)
The Supabase clients are untyped for now. Once running, generate types and you
get full autocomplete/safety:
```
npx supabase login
npx supabase gen types typescript --project-id dprohuezrzulvjhznbio > lib/database.types.ts
```
Then add the `<Database>` generic back into the three files in `lib/supabase/`.

## Next
Commit to `dev`, then move to Milestone 1 (occupancy, expenses, energy, vehicles).
