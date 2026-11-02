-- =====================================================================
-- Outstation car packages (Master data > Outstation car packages), from the Delhi rate sheet
-- of 2 Nov 2026. One price for the car over the whole road trip, used instead of pricing each
-- drive (Delhi airport -> Agra hotel -> Jaipur hotel -> Delhi airport):
--   Delhi - Agra - Delhi            1 night / 2 days     Rs 21,000
--   Delhi - Agra - Delhi            2 nights / 3 days    Rs 25,000
--   Delhi - Agra - Jaipur - Delhi   3 nights / 4 days    Rs 40,000
--   Delhi - Agra - Jaipur - Delhi   4 nights / 5 days    Rs 50,000
-- Innova / Crysta (up to 6 guests), + 5% GST like the other transfers of this sheet, to 30 Sep 2027.
-- Also from the sheet (outstation): local guide Rs 8,000 per day and accompanying guide
-- Rs 11,000 per day, + 5% GST, as add-ons of the Agra and Jaipur hotels (as Roseate House has).
--
-- HOW IT RUNS: one statement (a DO block) for the Supabase SQL Editor; all or nothing.
-- Safe to run more than once: the table is created once, a package for the same cities and
-- nights is corrected (never added twice), a guide already at a hotel is not added again.
-- =====================================================================

do $pkg$
declare
  n int;
begin
  create table if not exists public.sales_car_packages (
    id            uuid primary key default gen_random_uuid(),
    name          text not null check (length(btrim(name)) between 2 and 120),
    route         text not null check (length(btrim(route)) between 5 and 200), -- "Delhi - Agra - Delhi"
    nights        integer not null check (nights between 1 and 30),
    vehicle_type  text not null default 'Innova / Crysta',
    capacity      integer not null default 6 check (capacity between 1 and 60),
    rate          numeric(12, 2) not null check (rate >= 0),
    tax_pct       numeric(5, 2) not null default 0 check (tax_pct between 0 and 50),
    valid_from    date,
    valid_to      date,
    notes         text,
    active        boolean not null default true,
    created_at    timestamptz not null default now()
  );

  alter table public.sales_car_packages enable row level security;

  drop policy if exists sales_car_packages_select on public.sales_car_packages;
  create policy sales_car_packages_select on public.sales_car_packages
    for select to authenticated
    using (exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active'
        and p.role in ('super_admin', 'senior_manager', 'sales_admin', 'sales_member')
    ));

  drop policy if exists sales_car_packages_admin_write on public.sales_car_packages;
  create policy sales_car_packages_admin_write on public.sales_car_packages
    for all to authenticated
    using (exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
    ))
    with check (exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and p.role in ('super_admin', 'senior_manager', 'sales_admin')
    ));

  create temp table cp_rows (name text, route text, nights int, rate numeric) on commit drop;
  insert into cp_rows values
    ('Delhi - Agra - Delhi (1 night / 2 days)',           'Delhi - Agra - Delhi',          1, 21000),
    ('Delhi - Agra - Delhi (2 nights / 3 days)',          'Delhi - Agra - Delhi',          2, 25000),
    ('Delhi - Agra - Jaipur - Delhi (3 nights / 4 days)', 'Delhi - Agra - Jaipur - Delhi', 3, 40000),
    ('Delhi - Agra - Jaipur - Delhi (4 nights / 5 days)', 'Delhi - Agra - Jaipur - Delhi', 4, 50000);

  update public.sales_car_packages t
  set name = r.name, rate = r.rate, tax_pct = 5, vehicle_type = 'Innova / Crysta', capacity = 6, valid_to = date '2027-09-30', active = true
  from cp_rows r
  where lower(t.route) = lower(r.route) and t.nights = r.nights
    and (t.rate <> r.rate or t.name <> r.name or t.tax_pct <> 5 or t.active is not true or t.valid_to is distinct from date '2027-09-30');
  get diagnostics n = row_count;
  raise notice 'packages corrected: %', n;

  insert into public.sales_car_packages (name, route, nights, vehicle_type, capacity, rate, tax_pct, valid_to, notes)
  select r.name, r.route, r.nights, 'Innova / Crysta', 6, r.rate, 5, date '2027-09-30', 'Delhi rate sheet, 2 Nov 2026'
  from cp_rows r
  where not exists (select 1 from public.sales_car_packages t where lower(t.route) = lower(r.route) and t.nights = r.nights);
  get diagnostics n = row_count;
  raise notice 'packages added: %', n;

  -- guides for the Agra and Jaipur hotels (outstation), like Roseate House's
  insert into public.sales_addons (name, property_id, pricing_unit, rate, tax_pct, active)
  select g.name, p.id, 'per_group', g.rate, 5, true
  from (values ('Local guide, per day', 8000, 'local guide'), ('Accompanying guide, per day', 11000, 'accompanying guide')) as g(name, rate, pattern)
  join public.sales_properties p
    on p.active is not false
   and (p.name ilike 'courtyard%agra%' or p.name ilike 'doubletree%agra%' or p.name ilike 'itc mughal%' or p.name ilike 'itc rajputana%')
  where not exists (select 1 from public.sales_addons a where a.property_id = p.id and a.active is not false and a.name ilike '%' || g.pattern || '%');
  get diagnostics n = row_count;
  raise notice 'guide add-ons added: %', n;
end
$pkg$;

notify pgrst, 'reload schema';

-- Check: the packages, and the guides of the Agra and Jaipur hotels
select 'Package' as "What", name as "Name", nights::text as "Nights", rate as "Rate", tax_pct as "GST %"
from public.sales_car_packages where active
union all
select 'Guide', p.name || ': ' || a.name, '', a.rate, a.tax_pct
from public.sales_addons a join public.sales_properties p on p.id = a.property_id
where a.active is not false and a.name ilike '%guide%'
  and (p.name ilike 'courtyard%agra%' or p.name ilike 'doubletree%agra%' or p.name ilike 'itc mughal%' or p.name ilike 'itc rajputana%')
order by 1 desc, 2;
