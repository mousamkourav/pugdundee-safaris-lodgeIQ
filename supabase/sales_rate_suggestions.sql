-- =====================================================================
-- Rate suggestions (Sales > Master data > Rate suggestions)
--   * When a sales member types a transfer price that is not in Master data and ticks
--     "Also save this rate in Master data", it is saved here as a suggestion. (A Sales
--     admin's price is saved straight into the transfer rates instead.)
--   * A Sales admin approves or rejects it in Master data. Approving adds the transfer
--     rate (one way per vehicle, both directions), unless the road has a rate by then.
--   * Sales users can see their own suggestions; Sales admins see and decide all of them.
--     The app writes suggestions on the server with the service key after checking the user.
-- Safe to run more than once: nothing is created twice.
-- Run any time (until then, members' prices are simply not saved as suggestions).
-- =====================================================================

-- the place columns take the same type as sales_locations.id
do $mk$
declare t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
  from pg_attribute a where a.attrelid = 'public.sales_locations'::regclass and a.attname = 'id';
  execute format('create table if not exists public.sales_rate_suggestions (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default ''transfer'' check (kind in (''transfer'')),
  from_location_id %1$s not null references public.sales_locations(id) on delete cascade,
  to_location_id   %1$s not null references public.sales_locations(id) on delete cascade,
  vehicle_type     text not null check (length(btrim(vehicle_type)) between 1 and 80),
  capacity         integer not null default 4 check (capacity between 1 and 60),
  rate             numeric not null check (rate > 0 and rate < 1000000), -- one way, per vehicle, incl. tax
  status           text not null default ''suggested'' check (status in (''suggested'', ''approved'', ''rejected'')),
  example          text check (example is null or length(example) <= 300), -- where it was typed, e.g. the quote
  created_by       uuid references auth.users(id) on delete set null,
  approved_by      uuid references auth.users(id) on delete set null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);', t);
end $mk$;

create index if not exists sales_rate_suggestions_status on public.sales_rate_suggestions (status, created_at desc);

alter table public.sales_rate_suggestions enable row level security;

drop policy if exists sales_rate_suggestions_select on public.sales_rate_suggestions;
create policy sales_rate_suggestions_select on public.sales_rate_suggestions
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
    )
  );

drop policy if exists sales_rate_suggestions_admin_write on public.sales_rate_suggestions;
create policy sales_rate_suggestions_admin_write on public.sales_rate_suggestions
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
  ));

-- keep updated_at current; on approval, add the transfer rate (once, if the road still has none)
create or replace function public.sales_rate_suggestions_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') and new.kind = 'transfer' then
    if not exists (
      select 1 from public.sales_transfer_rates r
      where r.active
        and ((r.from_location_id = new.from_location_id and r.to_location_id = new.to_location_id)
          or (r.from_location_id = new.to_location_id and r.to_location_id = new.from_location_id))
    ) then
      insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, night_surcharge, bidirectional, tax_pct, notes, active)
      values (new.from_location_id, new.to_location_id, new.vehicle_type, new.capacity, new.rate, 0, true, 0,
              'Suggested from a quote and approved (rate incl. tax).', true);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sales_rate_suggestions_touch on public.sales_rate_suggestions;
create trigger sales_rate_suggestions_touch before insert or update on public.sales_rate_suggestions
  for each row execute function public.sales_rate_suggestions_touch();

notify pgrst, 'reload schema';

-- check: the table, its policies, and the suggestions waiting
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'sales_rate_suggestions') as table_exists,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sales_rate_suggestions') as policies,
  (select count(*) from public.sales_rate_suggestions where status = 'suggested') as waiting_for_approval;
