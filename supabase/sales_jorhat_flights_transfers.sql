-- =====================================================================
-- Jorhat (for Kaziranga trips): flights and the road transfer
--   * Place: Jorhat Airport (JRH, Assam), added if missing
--   * Flight routes: Delhi -> Jorhat and Jorhat -> Delhi,
--     Rs 15,000 per person one way (an existing route is set to 15,000)
--   * Transfer: Jorhat Airport <-> Iora Retreat (Kaziranga), Innova / Crysta,
--     Rs 10,000, about 2 hours, both directions
--     (needs Iora Retreat in Master data: run sales_kaziranga_agra.sql first
--     if the check below shows no transfer)
-- Safe to run more than once: nothing is added twice, nothing is deleted.
-- Change any rate later in Master data.
-- =====================================================================
begin;

-- the airport
insert into public.sales_locations (type, name, code, state, active)
select 'airport', 'Jorhat Airport', 'JRH', 'Assam', true
where not exists (select 1 from public.sales_locations where name ilike 'jorhat%airport%');

-- flights, both ways, Rs 15,000 per person
insert into public.sales_flight_routes (from_city, to_city, fare, sort)
select x.f, x.t, 15000, 900
from (values ('Delhi', 'Jorhat'), ('Jorhat', 'Delhi')) as x(f, t)
where not exists (select 1 from public.sales_flight_routes r where r.from_city = x.f and r.to_city = x.t);

update public.sales_flight_routes
set fare = 15000
where ((from_city = 'Delhi' and to_city = 'Jorhat') or (from_city = 'Jorhat' and to_city = 'Delhi'))
  and fare <> 15000;

-- Jorhat Airport <-> Iora Retreat
insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active)
select a.id, h.id, 'Innova / Crysta', 4, 10000, 2, 0, true, 0, true
from public.sales_locations a
join public.sales_locations h on h.property_id = (select id from public.sales_properties where name ilike 'iora%' order by name limit 1)
where a.name ilike 'jorhat%airport%'
  and not exists (
    select 1 from public.sales_transfer_rates t
    where (t.from_location_id = a.id and t.to_location_id = h.id) or (t.from_location_id = h.id and t.to_location_id = a.id)
  );

commit;

notify pgrst, 'reload schema';

-- Check: 1 place, 2 flights at 15,000, 1 transfer at 10,000
select 'place' as what, l.name as item, null::numeric as rate
from public.sales_locations l where l.name ilike 'jorhat%airport%'
union all
select 'flight', r.from_city || ' -> ' || r.to_city, r.fare
from public.sales_flight_routes r where r.from_city = 'Jorhat' or r.to_city = 'Jorhat'
union all
select 'transfer', f.name || ' <-> ' || t2.name, t.rate
from public.sales_transfer_rates t
join public.sales_locations f on f.id = t.from_location_id
join public.sales_locations t2 on t2.id = t.to_location_id
where f.name ilike 'jorhat%' or t2.name ilike 'jorhat%'
order by 1, 2;
