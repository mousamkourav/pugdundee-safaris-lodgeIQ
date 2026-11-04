-- =====================================================================
-- Kaziranga flights (owner, 4 Nov 2026): guests fly into Jorhat or Guwahati at Rs 15,000 per
-- person one way, then drive to Iora Retreat (transfer rates already in Master data: Jorhat
-- Rs 10,000, Guwahati Rs 13,000, + 5%). Adds the Delhi - Guwahati and Delhi - Jorhat flight routes,
-- both ways, where they are missing, so the fare comes from Master data > Flight routes whichever
-- airport is chosen. Routes already there are not changed. Other cities: add them in Master data >
-- Flight routes (one row per direction).
-- Safe to run more than once. One statement for the Supabase SQL Editor; the select shows the result.
-- =====================================================================
insert into public.sales_flight_routes (from_city, to_city, fare, cabin, active)
select v.f, v.t, 15000, 'Economy', true
from (values ('Delhi', 'Guwahati'), ('Guwahati', 'Delhi'), ('Delhi', 'Jorhat'), ('Jorhat', 'Delhi')) as v(f, t)
where not exists (
  select 1 from public.sales_flight_routes r
  where r.active is not false and lower(r.from_city) like lower(v.f) || '%' and lower(r.to_city) like lower(v.t) || '%'
);

-- Check (expected: at least these 4 routes, each with its fare)
select from_city as "From", to_city as "To", airline as "Airline", fare as "Fare per person", active as "Active"
from public.sales_flight_routes
where lower(from_city) similar to '(guwahati|jorhat)%' or lower(to_city) similar to '(guwahati|jorhat)%'
order by to_city, from_city;
