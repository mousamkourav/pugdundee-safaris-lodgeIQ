-- =====================================================================
-- Kaziranga and Agra for the itinerary builder
--   Kaziranga National Park (Assam)
--     * Iora Retreat (partner lodge), room "Luxury Room", full board (AP)
--       Rs 15,000 double / Rs 12,000 single a night + 18% GST,
--       1 Oct 2026 - 31 May 2027
--     * Jeep safari Rs 15,000 per jeep, naturalist included,
--       morning and afternoon, 1 Oct 2026 - 31 May 2027, no GST added
--     * Places: Guwahati Airport, Jorhat Airport
--     * Transfers (Innova / Crysta): Guwahati Airport <-> Iora Retreat
--       Rs 13,000 (about 5 hours); Jorhat Airport <-> Iora Retreat
--       Rs 10,000 (about 2 hours); no GST added
--     * Add-on: camera fee Rs 500 per camera, per safari
--   Agra (city hotels, B&B / CP, + 18% GST)
--     * DoubleTree by Hilton Agra, Courtyard by Marriott Agra:
--       Rs 20,000 a night to 31 Mar 2027, Rs 15,000 from 1 Apr to 30 Sep 2027
--     * ITC Mughal Agra: Rs 25,000 to 31 Mar 2027, Rs 15,000 from 1 Apr to 30 Sep 2027
--   Flight routes Delhi <-> Guwahati and Delhi <-> Jorhat (default fare
--   Rs 15,000 per person, change it in Master data > Flights)
-- Safe to run more than once: nothing is added twice, nothing is deleted.
-- Anything already in Master data with the same name is left as it is.
-- Change any rate later in Master data.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- park
insert into public.sales_parks (name, state, short_desc, website, sort, active)
select 'Kaziranga National Park', 'Assam',
  'A World Heritage Site on the floodplains of the Brahmaputra, Kaziranga is home to two-thirds of the world''s greater one-horned rhinos, with wild water buffalo, swamp deer, elephants and tigers in its tall grasslands and wetlands.',
  null, 0, true
where not exists (select 1 from public.sales_parks where name ilike 'kaziranga%');

-- ---------------------------------------------------- lodges and hotels
insert into public.sales_properties (name, kind, park_id, city, fallback_priority, active)
select 'Iora Retreat', 'partner_lodge', p.id, null, 100, true
from public.sales_parks p
where p.name ilike 'kaziranga%'
  and not exists (select 1 from public.sales_properties where name ilike 'iora%');

insert into public.sales_properties (name, kind, park_id, city, fallback_priority, active)
select x.name, 'city_hotel', null, 'Agra', 100, true
from (values ('DoubleTree by Hilton Agra', 'doubletree%agra%'), ('Courtyard by Marriott Agra', 'courtyard%agra%'), ('ITC Mughal Agra', 'itc mughal%')) as x(name, pattern)
where not exists (select 1 from public.sales_properties where name ilike x.pattern);

-- each lodge or hotel is also a place (the app does this when one is saved)
insert into public.sales_locations (type, name, property_id, active)
select 'property', pr.name, pr.id, true
from public.sales_properties pr
where (pr.name ilike 'iora%' or pr.name ilike 'doubletree%agra%' or pr.name ilike 'courtyard%agra%' or pr.name ilike 'itc mughal%')
  and not exists (select 1 from public.sales_locations l where l.property_id = pr.id);

-- airports
insert into public.sales_locations (type, name, code, state, active)
select 'airport', x.name, x.code, 'Assam', true
from (values ('Guwahati Airport', 'GAU'), ('Jorhat Airport', 'JRH')) as x(name, code)
where not exists (select 1 from public.sales_locations l where l.name ilike split_part(x.name, ' ', 1) || '%airport%');

-- ------------------------------------------------------------- rooms
insert into public.sales_room_categories (property_id, name, max_adults, max_children, extra_bed, sort, active)
select pr.id, case when pr.name ilike 'iora%' then 'Luxury Room' else 'Deluxe Room' end, 2, 1, false, 0, true
from public.sales_properties pr
where (pr.name ilike 'iora%' or pr.name ilike 'doubletree%agra%' or pr.name ilike 'courtyard%agra%' or pr.name ilike 'itc mughal%')
  and not exists (select 1 from public.sales_room_categories rc where rc.property_id = pr.id);

-- room rates: only for rooms that have none yet
insert into public.sales_room_rates (room_category_id, valid_from, valid_to, meal_plan, rate_single, rate_double, min_nights, tax_pct, rates_include_tax, active)
select rc.id, x.valid_from::date, x.valid_to::date, x.meal_plan, x.rate_single, x.rate_double, 1, 18, false, true
from public.sales_room_categories rc
join public.sales_properties pr on pr.id = rc.property_id
join (values
  ('iora%',             '2026-10-01', '2027-05-31', 'AP', 12000::numeric, 15000::numeric),
  ('doubletree%agra%',  '2026-10-01', '2027-03-31', 'CP', null, 20000),
  ('doubletree%agra%',  '2027-04-01', '2027-09-30', 'CP', null, 15000),
  ('courtyard%agra%',   '2026-10-01', '2027-03-31', 'CP', null, 20000),
  ('courtyard%agra%',   '2027-04-01', '2027-09-30', 'CP', null, 15000),
  ('itc mughal%',       '2026-10-01', '2027-03-31', 'CP', null, 25000),
  ('itc mughal%',       '2027-04-01', '2027-09-30', 'CP', null, 15000)
) as x(pattern, valid_from, valid_to, meal_plan, rate_single, rate_double) on pr.name ilike x.pattern
where rc.id = (select min(rc2.id::text)::uuid from public.sales_room_categories rc2 where rc2.property_id = pr.id)
  and not exists (select 1 from public.sales_room_rates r where r.room_category_id = rc.id);

-- ----------------------------------------------------------- safaris
insert into public.sales_safari_rates (park_id, zone, session, vehicle_type, pricing_unit, nationality, valid_from, valid_to, weekday_rate, weekend_rate, max_pax, includes_naturalist, naturalist_fee, guide_fee, active)
select p.id, 'core', s.session, 'exclusive_jeep', 'per_vehicle', 'all', '2026-10-01', '2027-05-31', 15000, 15000, 6, true, 0, 0, true
from public.sales_parks p
cross join (values ('morning'), ('afternoon')) as s(session)
where p.name ilike 'kaziranga%'
  and not exists (select 1 from public.sales_safari_rates r where r.park_id = p.id and r.session = s.session);

-- --------------------------------------------------------- transfers
insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active)
select a.id, h.id, 'Innova / Crysta', 4, x.rate, x.hours, 0, true, 0, true
from (values ('guwahati%airport%', 13000::numeric, 5::numeric), ('jorhat%airport%', 10000, 2)) as x(airport, rate, hours)
join public.sales_locations a on a.name ilike x.airport
join public.sales_locations h on h.property_id = (select id from public.sales_properties where name ilike 'iora%' limit 1)
where not exists (
  select 1 from public.sales_transfer_rates t
  where (t.from_location_id = a.id and t.to_location_id = h.id) or (t.from_location_id = h.id and t.to_location_id = a.id)
);

-- ------------------------------------------------------------ add-on
insert into public.sales_addons (name, property_id, pricing_unit, rate, tax_pct, active)
select 'Kaziranga camera fee (per camera, per safari)', pr.id, 'per_group', 500, 0, true
from public.sales_properties pr
where pr.name ilike 'iora%'
  and not exists (select 1 from public.sales_addons a where a.name ilike 'kaziranga camera fee%');

-- ------------------------------------------------------ flight routes
insert into public.sales_flight_routes (from_city, to_city, fare, sort)
select x.f, x.t, 15000, 900
from (values ('Delhi', 'Guwahati'), ('Guwahati', 'Delhi'), ('Delhi', 'Jorhat'), ('Jorhat', 'Delhi')) as x(f, t)
where not exists (select 1 from public.sales_flight_routes r where r.from_city = x.f and r.to_city = x.t);

commit;

notify pgrst, 'reload schema';

-- Check: every line should show a rate
select 'room rate' as what, pr.name || ' / ' || rc.name || ' ' || r.meal_plan || ' from ' || r.valid_from as item, r.rate_double as rate
from public.sales_room_rates r
join public.sales_room_categories rc on rc.id = r.room_category_id
join public.sales_properties pr on pr.id = rc.property_id
where pr.name ilike 'iora%' or pr.name ilike 'doubletree%agra%' or pr.name ilike 'courtyard%agra%' or pr.name ilike 'itc mughal%'
union all
select 'safari', p.name || ' ' || s.session, s.weekday_rate
from public.sales_safari_rates s join public.sales_parks p on p.id = s.park_id
where p.name ilike 'kaziranga%'
union all
select 'transfer', f.name || ' <-> ' || t2.name, t.rate
from public.sales_transfer_rates t
join public.sales_locations f on f.id = t.from_location_id
join public.sales_locations t2 on t2.id = t.to_location_id
where f.name ilike 'iora%' or t2.name ilike 'iora%'
union all
select 'add-on', a.name, a.rate from public.sales_addons a where a.name ilike 'kaziranga%'
union all
select 'flight', r.from_city || ' -> ' || r.to_city, r.fare
from public.sales_flight_routes r where r.from_city in ('Guwahati', 'Jorhat') or r.to_city in ('Guwahati', 'Jorhat')
order by 1, 2;
