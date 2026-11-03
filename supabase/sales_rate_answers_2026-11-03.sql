-- =====================================================================
-- Rate audit: management's answers of 3 Nov 2026, put into Master data.
--  1. Ken River, Royal Enfield per day: Rs 4,000 incl. GST (B2B sheet 2026-27). Was Rs 300.
--  2. Picnic lunch: one Pugdundee experience, Rs 4,000 + 18% per person, at all our lodges
--     (the same lodges as "Nature walk / cycling / night trail"). The Kanha row "Banjar River
--     picnic" (Rs 2,000 + 5%) becomes it: same row and id, so saved quotes keep it.
--  3. Culinary workshop: new Pugdundee experience, Rs 2,500 + 5% per person (2 guests or more),
--     at all our lodges (same lodges as the nature walk).
--  4. Kanha Earth Lodge, Buffer walk: new, Rs 3,000 + 5% per person (2 guests or more), as at
--     Denwa and Pench.
--  5. Pench, "Runi Jhuni walking trail" is the buffer walk: renamed "Buffer walk (Runi Jhuni
--     walking trail)" so "buffer walk" in an enquiry finds it. Price unchanged.
-- Kept as they are (management): Khajuraho guide Rs 6,000; Kings Lodge / Tree House - Pench,
-- Innova Rs 15,500.
-- Safe to run more than once (only rows still wrong are changed; nothing added twice).
-- One statement (DO block) for the Supabase SQL Editor; the select at the end shows the result.
-- =====================================================================
do $answers$
declare
  n int;
  kanha public.sales_properties.id%type;
  walk_lodges public.sales_addons.offered_at%type;
begin
  select id into kanha from public.sales_properties where name ilike 'kanha earth%' limit 1;
  select offered_at into walk_lodges from public.sales_addons
   where name = 'Nature walk / cycling / night trail' and property_id is null and active is not false limit 1;
  if kanha is null or walk_lodges is null then
    raise exception 'Kanha Earth Lodge or the nature walk add-on not found: nothing changed';
  end if;

  -- 1. Royal Enfield
  update public.sales_addons a
     set rate = 4000
    from public.sales_properties p
   where p.id = a.property_id and p.name ilike 'ken river%'
     and a.name ilike 'royal enfield%' and a.rate is distinct from 4000;
  get diagnostics n = row_count;
  raise notice '1. Royal Enfield rows corrected: %', n;

  -- 2. Picnic lunch (the Banjar River picnic row)
  update public.sales_addons
     set name = 'Picnic lunch', property_id = null, park_id = null, rate = 4000, rate_foreign = null,
         tax_pct = 18, pricing_unit = 'per_person', min_guests = 2, offered_at = walk_lodges
   where property_id = kanha and name = 'Banjar River picnic';
  get diagnostics n = row_count;
  raise notice '2. Picnic lunch made Pugdundee-wide: %', n;

  -- 3. Culinary workshop
  insert into public.sales_addons (name, property_id, park_id, pricing_unit, rate, tax_pct, active, min_guests, offered_at)
  select 'Culinary workshop', null, null, 'per_person', 2500, 5, true, 2, walk_lodges
   where not exists (select 1 from public.sales_addons where name ilike 'culinary workshop%' and active is not false);
  get diagnostics n = row_count;
  raise notice '3. Culinary workshop added: %', n;

  -- 4. Kanha buffer walk
  insert into public.sales_addons (name, property_id, park_id, pricing_unit, rate, tax_pct, active, min_guests)
  select 'Buffer walk', kanha, null, 'per_person', 3000, 5, true, 2
   where not exists (select 1 from public.sales_addons where property_id = kanha and name ilike '%buffer%walk%' and active is not false);
  get diagnostics n = row_count;
  raise notice '4. Kanha buffer walk added: %', n;

  -- 5. Pench buffer walk name
  update public.sales_addons a
     set name = 'Buffer walk (Runi Jhuni walking trail)'
    from public.sales_properties p
   where p.id = a.property_id and p.name ilike 'pench tree%' and a.name = 'Runi Jhuni walking trail';
  get diagnostics n = row_count;
  raise notice '5. Pench walk renamed: %', n;
end
$answers$;

-- Check (expected 5 rows; "Lodges offering" 6 for the two Pugdundee-wide ones, 0 for the others):
--   Buffer walk                              Kanha Earth Lodge   3000  5%   per_person
--   Buffer walk (Runi Jhuni walking trail)   Pench Tree Lodge    3000  5%   per_person
--   Culinary workshop                        Pugdundee (all)     2500  5%   per_person
--   Picnic lunch                             Pugdundee (all)     4000  18%  per_person
--   Royal Enfield Bullet motorcycle, per day Ken River Lodge     4000  0%   per_group
select a.name as "Add-on", coalesce(p.name, 'Pugdundee (all our lodges)') as "Lodge", a.rate as "Rate",
       a.tax_pct as "GST %", a.pricing_unit as "Unit", a.min_guests as "Min guests",
       coalesce(array_length(a.offered_at, 1), 0) as "Lodges offering (Pugdundee-wide)"
from public.sales_addons a
left join public.sales_properties p on p.id = a.property_id
where a.active is not false
  and (a.name in ('Picnic lunch', 'Culinary workshop', 'Buffer walk', 'Buffer walk (Runi Jhuni walking trail)')
       or a.name ilike 'royal enfield%')
order by a.name;
