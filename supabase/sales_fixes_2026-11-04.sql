-- =====================================================================
-- Fixes from Manav's quotes of 4 Nov 2026 (Master data only).
--  1. Kaziranga National Park: monsoon closure 1 Jun - 30 Sep 2027 (the park reopens on 1 October).
--     Master data had none, so a Kaziranga trip in those months planned safaris and asked for their
--     price. With it, those days say "No safari: park closed (Monsoon closure)" and nothing is priced.
--     (Iora Retreat's room rate also ends 31 May 2027 on the partner sheet: a stay after that still
--     needs Iora's rate in Master data > Lodge exceptions, or a typed price.)
--  2. "Accompanying naturalist, full-day safari": Rs 7,500 a jeep (GST as the naturalist add-on), at
--     the same lodges as "Accompanying naturalist". A full-day safari with a naturalist takes this
--     price; morning and evening safaris keep the Rs 2,500 naturalist.
-- Safe to run more than once. One statement (DO block) for the Supabase SQL Editor; the select at
-- the end shows the result.
-- =====================================================================
do $fix$
declare n int;
begin
  insert into public.sales_park_closures (park_id, zone, closure_type, weekday, session, date_from, date_to, label)
  select p.id, 'all', 'date_range', null, 'full_day', date '2027-06-01', date '2027-09-30', 'Monsoon closure (reopens 1 October)'
  from public.sales_parks p
  where p.name ilike 'kaziranga%'
    and not exists (
      select 1 from public.sales_park_closures c
      where c.park_id = p.id and c.closure_type = 'date_range'
        and c.date_from <= date '2027-09-30' and c.date_to >= date '2027-06-01');
  get diagnostics n = row_count;
  raise notice '1. Kaziranga monsoon closure added: %', n;

  insert into public.sales_addons (name, property_id, park_id, pricing_unit, rate, tax_pct, active, offered_at)
  select 'Accompanying naturalist, full-day safari', null, null, 'per_vehicle', 7500, a.tax_pct, true, a.offered_at
  from public.sales_addons a
  where a.name = 'Accompanying naturalist' and a.property_id is null and a.active is not false
    and not exists (select 1 from public.sales_addons x where x.name ilike 'accompanying naturalist, full%day%' and x.active is not false)
  limit 1;
  get diagnostics n = row_count;
  raise notice '2. Full-day naturalist added: %', n;
end
$fix$;

-- Check (expected 3 rows): the Kaziranga closure 2027-06-01 to 2027-09-30, and the two naturalists
-- (2,500 and 7,500, per jeep, with the same GST and the same lodges)
select 'Closure' as "What", p.name as "Item", c.date_from || ' to ' || c.date_to || ' (' || c.label || ')' as "Value"
from public.sales_park_closures c join public.sales_parks p on p.id = c.park_id
where p.name ilike 'kaziranga%' and c.closure_type = 'date_range'
union all
select 'Naturalist', a.name, a.rate || ' per jeep + ' || a.tax_pct || '%, at ' || coalesce(array_length(a.offered_at, 1), 0) || ' lodges'
from public.sales_addons a
where a.name ilike 'accompanying naturalist%' and a.property_id is null and a.active is not false
order by 1, 2;
