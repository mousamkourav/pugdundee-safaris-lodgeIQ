-- =====================================================================
-- Reading memory for the trip assistant (Sales > Master data > Reading memory)
--   * sales_reading_patterns: an enquiry as typed (normalised: lower case, numbers as
--     digits, taught phrases applied, names / emails / phone numbers removed) and the
--     trip that was quoted for it. The next time the same enquiry is typed, or the same
--     enquiry with only dates, numbers or names changed, it is read from here: no AI call.
--     hits counts how often a pattern was used.
--   * Saved by the app (service key, after checking the user) when a quote is saved for
--     the guest. Sales users can read the patterns; Sales admins can correct or delete them.
--   * sales_chat_log gets three columns: how long the AI took, where the reading came
--     from (memory / ai), and what was missing when the AI was asked.
-- Safe to run more than once: nothing is created twice.
-- Run any time (the app works without this table and simply remembers nothing).
-- =====================================================================

create table if not exists public.sales_reading_patterns (
  id           uuid primary key default gen_random_uuid(),
  key          text not null check (length(key) between 15 and 2000),  -- the normalised enquiry
  structure    text not null check (length(structure) <= 2000),        -- the same, dates as #d and numbers as #
  tokens       jsonb not null default '[]'::jsonb,                     -- the dates and numbers, in order
  reading      jsonb not null,                                         -- the quoted trip (AI answer shape)
  hits         integer not null default 0 check (hits >= 0),
  query_id     uuid,                                                   -- the quote it was learned from
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- one row per enquiry text (saved again: the reading is replaced with the newer quote)
create unique index if not exists sales_reading_patterns_key on public.sales_reading_patterns (key);
create index if not exists sales_reading_patterns_structure on public.sales_reading_patterns (structure);

alter table public.sales_reading_patterns enable row level security;

drop policy if exists sales_reading_patterns_select on public.sales_reading_patterns;
create policy sales_reading_patterns_select on public.sales_reading_patterns
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
      and p.role in ('super_admin', 'senior_manager', 'sales_admin', 'sales_member')
  ));

drop policy if exists sales_reading_patterns_admin_delete on public.sales_reading_patterns;
drop policy if exists sales_reading_patterns_admin_write on public.sales_reading_patterns;
create policy sales_reading_patterns_admin_write on public.sales_reading_patterns
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
  ));

create or replace function public.sales_reading_patterns_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sales_reading_patterns_touch on public.sales_reading_patterns;
create trigger sales_reading_patterns_touch before update on public.sales_reading_patterns
  for each row execute function public.sales_reading_patterns_touch();

-- the AI log: duration, source and the gaps it was asked to fill
alter table if exists public.sales_chat_log add column if not exists duration_ms integer;
alter table if exists public.sales_chat_log add column if not exists source text;
alter table if exists public.sales_chat_log add column if not exists gaps text[];

-- check: the table, its policies, how many patterns, and the new log columns
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sales_reading_patterns') as table_exists,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_reading_patterns') as policies,
  (select count(*) from public.sales_reading_patterns) as patterns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sales_chat_log' and column_name in ('duration_ms', 'source', 'gaps')) as new_log_columns;
