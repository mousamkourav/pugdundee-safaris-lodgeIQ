-- =====================================================================
-- Lodge to lodge roads that had no rate (Master data > Missing transfer rates), with the
-- owner's prices of 2 Nov 2026. Innova / Crysta, + 5% GST, one rate both ways, to 30 Sep 2027:
--   Kings Lodge <-> Tree House Hideaway            no charge (same park): Rs 0, no GST
--   Bandhavgarh <-> Tadoba  (Kings, Tree House <-> Waghoba)        Rs 18,500
--   Bandhavgarh <-> Satpura (Kings, Tree House <-> Denwa)          Rs 17,500
--   Kanha  <-> Tadoba  (Kanha Earth Lodge <-> Waghoba)             Rs 17,500
--   Kanha  <-> Panna   (Kanha Earth Lodge <-> Ken River Lodge)     Rs 17,500
--   Pench  <-> Panna   (Pench Tree Lodge <-> Ken River Lodge)      Rs 17,500
--   Satpura <-> Panna  (Denwa Backwater Escape <-> Ken River)      Rs 17,500
--   Khajuraho <-> Panna (Radisson Khajuraho <-> Ken River Lodge)   Rs 3,500
--   Radisson Khajuraho <-> Tree House Hideaway: the same rate(s) as Kings Lodge <-> Radisson
--   (owner: "same"), copied for every vehicle Kings Lodge has.
-- Tadoba <-> Panna: not sold, not added.
-- Drive hours are left empty (add them in Master data > Transfers when known).
--
-- HOW IT RUNS: one statement (a DO block) for the Supabase SQL Editor; all or nothing.
-- Safe to run more than once: an existing rate for the road and vehicle is corrected, never
-- added twice. The select at the end lists every one of these roads with its rate.
-- =====================================================================

do $roads$
declare
  n int;
  innova text;
begin
  -- the name Master data uses for the Innova (as the other rates)
  select x.vehicle_type into innova from public.sales_transfer_rates x where x.vehicle_type ~* '(innova|crysta)' group by x.vehicle_type order by count(*) desc limit 1;
  innova := coalesce(innova, 'Innova / Crysta');

  -- each lodge's place
  create temp table lr_place (key text, id uuid) on commit drop;
  insert into lr_place
  select k.key, (select l.id from public.sales_locations l join public.sales_properties p on p.id = l.property_id
                 where p.name ilike k.pattern and l.active is not false order by p.name limit 1)
  from (values ('KL', 'kings lodge%'), ('THH', 'tree house hideaway%'), ('WEL', 'waghoba%'), ('DBE', 'denwa%'),
               ('KEL', 'kanha earth%'), ('KRL', 'ken river%'), ('PTL', 'pench tree%'), ('RAD', 'radisson%khajuraho%')) as k(key, pattern);

  create temp table lr_road (a text, b text, rate numeric, tax numeric) on commit drop;
  insert into lr_road values
    ('KL', 'THH', 0, 0),
    ('KL', 'WEL', 18500, 5), ('THH', 'WEL', 18500, 5),
    ('KL', 'DBE', 17500, 5), ('THH', 'DBE', 17500, 5),
    ('KEL', 'WEL', 17500, 5),
    ('KEL', 'KRL', 17500, 5),
    ('PTL', 'KRL', 17500, 5),
    ('DBE', 'KRL', 17500, 5),
    ('RAD', 'KRL', 3500, 5);

  -- a missing lodge or hotel is said, not skipped silently
  if exists (select 1 from lr_place where id is null) then
    raise notice 'Not found in Master data (its roads are skipped): %', (select string_agg(key, ', ') from lr_place where id is null);
  end if;

  -- correct an existing Innova rate for the road (either direction)
  update public.sales_transfer_rates t
  set rate = r.rate, tax_pct = r.tax, active = true
  from lr_road r
  join lr_place a on a.key = r.a and a.id is not null
  join lr_place b on b.key = r.b and b.id is not null
  where t.vehicle_type ~* '(innova|crysta)'
    and ((t.from_location_id = a.id and t.to_location_id = b.id) or (t.from_location_id = b.id and t.to_location_id = a.id))
    and (t.rate <> r.rate or t.tax_pct is distinct from r.tax or t.active is not true);
  get diagnostics n = row_count;
  raise notice 'rates corrected: %', n;

  -- add the ones that have none
  insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active, valid_to)
  select a.id, b.id, innova, 6, r.rate, null, 0, true, r.tax, true, date '2027-09-30'
  from lr_road r
  join lr_place a on a.key = r.a and a.id is not null
  join lr_place b on b.key = r.b and b.id is not null
  where not exists (
    select 1 from public.sales_transfer_rates t
    where t.vehicle_type ~* '(innova|crysta)'
      and ((t.from_location_id = a.id and t.to_location_id = b.id) or (t.from_location_id = b.id and t.to_location_id = a.id))
  );
  get diagnostics n = row_count;
  raise notice 'rates added: %', n;

  -- Radisson Khajuraho <-> Tree House Hideaway: a copy of each Kings Lodge <-> Radisson rate (every vehicle)
  insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active, valid_from, valid_to, notes)
  select thh.id, rad.id, t.vehicle_type, t.capacity, t.rate, t.drive_hours, t.night_surcharge, true, t.tax_pct, true, t.valid_from, t.valid_to, 'Same as Kings Lodge - Radisson (owner, 2 Nov 2026)'
  from public.sales_transfer_rates t
  join lr_place kl on kl.key = 'KL'
  join lr_place rad on rad.key = 'RAD'
  join lr_place thh on thh.key = 'THH'
  where t.active is not false and kl.id is not null and rad.id is not null and thh.id is not null
    and ((t.from_location_id = kl.id and t.to_location_id = rad.id) or (t.from_location_id = rad.id and t.to_location_id = kl.id))
    and not exists (
      select 1 from public.sales_transfer_rates x
      where x.vehicle_type = t.vehicle_type
        and ((x.from_location_id = thh.id and x.to_location_id = rad.id) or (x.from_location_id = rad.id and x.to_location_id = thh.id))
    );
  get diagnostics n = row_count;
  raise notice 'Radisson - Tree House Hideaway rates added (copied from Kings Lodge): %', n;
end
$roads$;

notify pgrst, 'reload schema';

-- Check: every road of this file with its rate (both directions are one road)
select fa.name as "From", fb.name as "To", t.vehicle_type as "Vehicle", t.rate as "Rate", t.tax_pct as "GST %"
from public.sales_transfer_rates t
join public.sales_locations fa on fa.id = t.from_location_id
join public.sales_locations fb on fb.id = t.to_location_id
where t.active is not false
  and (
    (fa.name ~* '^(kings lodge|tree house hideaway)' and fb.name ~* '^(kings lodge|tree house hideaway|waghoba|denwa|radisson)')
    or (fb.name ~* '^(kings lodge|tree house hideaway)' and fa.name ~* '^(waghoba|denwa|radisson)')
    or (fa.name ~* '^kanha earth' and fb.name ~* '^(waghoba|ken river)') or (fb.name ~* '^kanha earth' and fa.name ~* '^(waghoba|ken river)')
    or (fa.name ~* '^(pench tree|denwa|radisson)' and fb.name ~* '^ken river') or (fb.name ~* '^(pench tree|denwa|radisson)' and fa.name ~* '^ken river')
  )
order by 1, 2, 3;
