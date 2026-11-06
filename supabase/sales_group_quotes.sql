-- =====================================================================
-- Group quotes (Sales > Group quotes, 6 Nov 2026): quotes for tour operators' groups (6 + 1 tour
-- leader, 8 + 2...) built with the same builder, Master data and rates as every quote, plus a
-- costing sheet and a price ladder by group size.
--   * sales_queries.query_type may now be 'group' (as well as 'safari' and 'red_panda')
--   * sales_group_access: who may make group quotes, by person or by role (like the SOP and Red
--     Panda). The super admin always. Only the super admin gives or removes access.
--   * sales_group_can_use(): the check the app and the database use
--   * sales_group_audit: every change of access (a trigger)
-- Needs supabase/red_panda.sql run before (it added query_type).
-- Safe to run more than once. Run BEFORE pushing the code.
-- One DO block for the Supabase SQL Editor; the select at the end shows the result.
-- =====================================================================
do $grp$
begin
  -- ------------------------------------------------------------------ the quote type
  alter table public.sales_queries add column if not exists query_type text not null default 'safari';
  alter table public.sales_queries drop constraint if exists sales_queries_query_type_check;
  alter table public.sales_queries add constraint sales_queries_query_type_check check (query_type in ('safari','red_panda','group'));

  -- ------------------------------------------------------------------ access
  create table if not exists public.sales_group_access (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references public.profiles(id) on delete cascade,
    role        text,
    granted_by  uuid references public.profiles(id) on delete set null default auth.uid(),
    created_at  timestamptz not null default now(),
    check ((user_id is null) <> (role is null))
  );
  create unique index if not exists sales_group_access_user on public.sales_group_access (user_id) where user_id is not null;
  create unique index if not exists sales_group_access_role on public.sales_group_access (role) where role is not null;

  create table if not exists public.sales_group_audit (
    id          bigint generated always as identity primary key,
    row_id      text,
    action      text not null,
    old_row     jsonb,
    new_row     jsonb,
    actor       uuid default auth.uid(),
    at          timestamptz not null default now()
  );

  create or replace function public.sales_group_is_editor()
  returns boolean language sql stable security definer set search_path = public as $f$
    select coalesce((select p.role = 'super_admin' and coalesce(p.status, 'active') = 'active' from public.profiles p where p.id = auth.uid()), false);
  $f$;

  create or replace function public.sales_group_can_use()
  returns boolean language sql stable security definer set search_path = public as $f$
    select public.sales_group_is_editor() or exists (
      select 1 from public.profiles p
      join public.sales_group_access a on (a.user_id = p.id or a.role = p.role)
      where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
    );
  $f$;

  create or replace function public.sales_group_audit_row()
  returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    insert into public.sales_group_audit (row_id, action, old_row, new_row, actor)
    values (coalesce(new.id, old.id)::text, lower(tg_op),
            case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
            case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
            auth.uid());
    return coalesce(new, old);
  end $f$;
  drop trigger if exists sales_group_access_audit on public.sales_group_access;
  create trigger sales_group_access_audit after insert or update or delete on public.sales_group_access for each row execute function public.sales_group_audit_row();

  alter table public.sales_group_access enable row level security;
  alter table public.sales_group_audit enable row level security;
  drop policy if exists sales_group_access_editor on public.sales_group_access;
  create policy sales_group_access_editor on public.sales_group_access for all to authenticated using (public.sales_group_is_editor()) with check (public.sales_group_is_editor());
  drop policy if exists sales_group_audit_editor on public.sales_group_audit;
  create policy sales_group_audit_editor on public.sales_group_audit for select to authenticated using (public.sales_group_is_editor());
end
$grp$;

notify pgrst, 'reload schema';

-- Check (expected: type_check 1, rls_on 2, policies 2, functions 2)
select
  (select count(*) from pg_constraint where conname = 'sales_queries_query_type_check' and pg_get_constraintdef(oid) like '%group%') as type_check,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity and c.relname in ('sales_group_access','sales_group_audit')) as rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('sales_group_access','sales_group_audit')) as policies,
  (select count(*) from pg_proc where proname in ('sales_group_can_use','sales_group_is_editor')) as functions;
