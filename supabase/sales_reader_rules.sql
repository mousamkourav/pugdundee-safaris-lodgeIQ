-- =====================================================================
-- Reader rules: what the built-in trip reader learns (Sales > Master data)
--   * One table, sales_reader_rules: a phrase the team types and what it means,
--     e.g. "tadoba core" -> "Waghoba Eco Lodge", "gaddi" -> "own vehicle".
--   * source = 'correction': suggested when a sales person changed what the reader
--     filled in (lodge, park, nights, safaris, transport) before saving a quote.
--     source = 'unknown': a word the reader could not place, logged for an admin
--     to teach (fill in the meaning, then approve). source = 'admin': typed by hand.
--   * status: 'suggested' (waiting), 'approved' (the reader uses it), 'rejected'.
--   * Sales users can read the rules; only Sales admins can change them. The app
--     writes suggestions on the server with the service key after checking the user.
-- Safe to run more than once: nothing is created twice.
-- Run any time (the app works without this table and simply learns nothing).
-- =====================================================================

create table if not exists public.sales_reader_rules (
  id          uuid primary key default gen_random_uuid(),
  phrase      text not null check (length(btrim(phrase)) between 2 and 80),
  meaning     text check (meaning is null or length(meaning) <= 80),
  kind        text not null default 'word'
              check (kind in ('word', 'park', 'lodge', 'nights', 'safaris', 'transport', 'place', 'room')),
  source      text not null default 'admin' check (source in ('correction', 'unknown', 'admin')),
  status      text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected')),
  seen        integer not null default 1 check (seen >= 1),
  example     text check (example is null or length(example) <= 500), -- the enquiry, names removed
  created_by  uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- an approved rule must say what the phrase means
  constraint sales_reader_rules_meaning_when_approved check (status <> 'approved' or (meaning is not null and length(btrim(meaning)) > 0))
);

-- one row per phrase and source (a word seen again counts up instead of a new row)
create unique index if not exists sales_reader_rules_phrase_source on public.sales_reader_rules (lower(btrim(phrase)), source);
create index if not exists sales_reader_rules_status on public.sales_reader_rules (status);

alter table public.sales_reader_rules enable row level security;

drop policy if exists sales_reader_rules_select on public.sales_reader_rules;
create policy sales_reader_rules_select on public.sales_reader_rules
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('super_admin', 'senior_manager', 'sales_admin', 'sales_member')
  ));

drop policy if exists sales_reader_rules_admin_write on public.sales_reader_rules;
create policy sales_reader_rules_admin_write on public.sales_reader_rules
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
  ));

-- keep updated_at current
create or replace function public.sales_reader_rules_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sales_reader_rules_touch on public.sales_reader_rules;
create trigger sales_reader_rules_touch before update on public.sales_reader_rules
  for each row execute function public.sales_reader_rules_touch();

-- check: the table, its policies and how many rules there are of each kind
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sales_reader_rules') as table_exists,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_reader_rules') as policies,
  (select count(*) from public.sales_reader_rules where status = 'approved') as approved_rules,
  (select count(*) from public.sales_reader_rules where status = 'suggested') as waiting_for_approval;
