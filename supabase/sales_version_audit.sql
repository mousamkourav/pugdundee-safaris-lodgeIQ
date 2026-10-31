-- =====================================================================
-- Quote versions: who corrected a version in place, and when
--   * When an edited quote is saved with "Update the current version" (a correction
--     before sending: same client link), the latest version is overwritten and a row is
--     written here: which version, who, when, and the total before and after.
--     ("Save as a new version" keeps the old version and makes a new link, as before.)
--   * Sales users see the rows of the queries they can see; only the app writes them
--     (service key, after checking the user can open the query).
--   * Also: indexes for the common lists (queries by member / status / date, versions
--     by query), used by the speed work.
-- Safe to run more than once: nothing is created twice.
-- Run any time (until then, a correction is saved without its audit row).
-- =====================================================================

do $mk$
declare vt text; qt text;
begin
  select format_type(a.atttypid, a.atttypmod) into vt from pg_attribute a where a.attrelid = 'public.sales_itinerary_versions'::regclass and a.attname = 'id';
  select format_type(a.atttypid, a.atttypmod) into qt from pg_attribute a where a.attrelid = 'public.sales_queries'::regclass and a.attname = 'id';
  execute format('create table if not exists public.sales_version_audit (
    id          uuid primary key default gen_random_uuid(),
    version_id  %1$s not null references public.sales_itinerary_versions(id) on delete cascade,
    query_id    %2$s not null references public.sales_queries(id) on delete cascade,
    version_no  integer,
    action      text not null default ''update'' check (action in (''update'')),
    old_total   numeric,
    new_total   numeric,
    changed_by  uuid references auth.users(id) on delete set null,
    changed_at  timestamptz not null default now()
  )', vt, qt);
end $mk$;

create index if not exists sales_version_audit_query on public.sales_version_audit (query_id, changed_at desc);

alter table public.sales_version_audit enable row level security;

-- readable wherever the query is readable (the queries' own policies decide)
drop policy if exists sales_version_audit_select on public.sales_version_audit;
create policy sales_version_audit_select on public.sales_version_audit
  for select to authenticated
  using (exists (select 1 from public.sales_queries q where q.id = query_id));

-- ---- indexes for the common filters (speed)
create index if not exists sales_itinerary_versions_query_version on public.sales_itinerary_versions (query_id, version_no desc);
create index if not exists sales_queries_status_created on public.sales_queries (status, created_at desc);
create index if not exists sales_queries_arrival on public.sales_queries (arrival_date);
do $ix$
begin
  -- the member a query belongs to: whichever of these columns the table has
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_queries' and column_name = 'assigned_to') then
    execute 'create index if not exists sales_queries_assigned on public.sales_queries (assigned_to, status, created_at desc)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_queries' and column_name = 'created_by') then
    execute 'create index if not exists sales_queries_created_by on public.sales_queries (created_by, status, created_at desc)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_queries' and column_name = 'deleted_at') then
    execute 'create index if not exists sales_queries_live on public.sales_queries (created_at desc) where deleted_at is null';
  end if;
end $ix$;

notify pgrst, 'reload schema';

-- check: the audit table, its policy, and the indexes on queries and versions
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sales_version_audit') as audit_table_exists,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_version_audit') as audit_policies,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename in ('sales_queries', 'sales_itinerary_versions') and indexname like 'sales_%') as sales_indexes;
