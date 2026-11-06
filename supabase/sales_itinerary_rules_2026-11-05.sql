-- =====================================================================
-- Sales itinerary rules (owner's decisions of 5 Nov 2026). Run in the Supabase SQL Editor.
--
-- 1. INDIAN GUESTS AT OUR OWN LODGES: the published Indian tariff (4 Nov 2026), not the BAR price.
--    Each own lodge's old seasonal rows in Master data > Room rates ("... per BAR policy", lodge
--    exceptions for ALL guests) are marked for FOREIGN guests only. Their prices are the foreign
--    BAR prices, so foreign quotes do not change. Nothing is deleted. Partner and city hotels, Ken
--    River's own rows and every other row are not touched.
--    Example: Pench AC Cottage, 10 Feb 2027, 2 adults: Indian Rs 19,500 a night (was Rs 22,000).
-- 2. TADOBA, INDIAN, CORE, booked 60-120 days ahead: Rs 14,000 weekday / Rs 18,500 weekend (+5% GST).
--    A row is added next to every Indian core "1-59 days" row that has none (the 2026-27 rows are
--    already in Master data; this adds the 2027-28 ones). A booking more than 120 days ahead uses it.
-- 3. FLIGHTS: every domestic flight in the circuit is Rs 15,000 per person one way.
--    a) Master data > Flight routes: every circuit route both ways (Delhi to and from Bhopal,
--       Jabalpur, Nagpur, Khajuraho, Raipur, Guwahati, Jorhat, Bagdogra; Central India airports to
--       and from Guwahati, Jorhat, Bagdogra; Guwahati / Jorhat to and from Bagdogra), added when
--       missing. A route already there keeps its fare, airline and times.
--    b) Sales settings: "Domestic flight fare" Rs 15,000, used for a flight with no route row
--       (only set when it is not set yet).
--
-- WHEN: any time (before or after the deploy). The builder reads Master data from a 5-minute
-- cache: new quotes use the change within 5 minutes. Quotes already saved are not changed.
-- HOW IT RUNS: one DO block, all or nothing. Safe to run more than once.
-- =====================================================================

do $rules$
declare
  n_bar int;
  n_tadoba int;
  n_routes int;
  airports text[] := array['Delhi', 'Bhopal', 'Jabalpur', 'Nagpur', 'Khajuraho', 'Raipur', 'Guwahati', 'Jorhat', 'Bagdogra'];
  central text[] := array['Bhopal', 'Jabalpur', 'Nagpur', 'Khajuraho', 'Raipur'];
  north_east text[] := array['Guwahati', 'Jorhat'];
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sales_room_rates' and column_name = 'nationality') then
    raise exception 'sales_room_rates has no nationality column: run the tariff SQL (sales_rate_card_2026.sql) first.';
  end if;

  -- 1. our own lodges' "per BAR policy" rows: foreign guests only
  update public.sales_room_rates rr
     set nationality = 'foreign'
    from public.sales_room_categories rc
    join public.sales_properties p on p.id = rc.property_id
   where rr.room_category_id = rc.id
     and coalesce(p.kind, 'own_lodge') = 'own_lodge'
     and coalesce(rr.nationality, 'all') = 'all'
     and rr.notes ilike '%per BAR policy%';
  get diagnostics n_bar = row_count;

  -- 2. Tadoba Indian core, booked 60-120 days ahead, next to each "1-59 days" row with the same validity
  insert into public.sales_safari_rates
    (park_id, zone, vehicle_type, session, pricing_unit, nationality, valid_from, valid_to, weekday_rate, weekend_rate,
     weekend_days, max_pax, naturalist_fee, includes_naturalist, guide_fee, tax_pct, active, book_min_days, book_max_days)
  select s.park_id, s.zone, s.vehicle_type, s.session, s.pricing_unit, s.nationality, s.valid_from, s.valid_to, 14000, 18500,
         s.weekend_days, s.max_pax, s.naturalist_fee, s.includes_naturalist, s.guide_fee, 5, true, 60, 120
    from public.sales_safari_rates s
    join public.sales_parks pk on pk.id = s.park_id
   where pk.name ilike 'tadoba%'
     and s.zone = 'core' and s.nationality = 'indian' and s.active
     and s.book_min_days = 1 and s.book_max_days = 59
     and not exists (
       select 1 from public.sales_safari_rates x
        where x.park_id = s.park_id and x.zone = s.zone and x.session = s.session and x.nationality = s.nationality
          and x.vehicle_type is not distinct from s.vehicle_type
          and x.valid_from is not distinct from s.valid_from and x.valid_to is not distinct from s.valid_to
          and x.book_min_days = 60 and x.book_max_days = 120);
  get diagnostics n_tadoba = row_count;

  -- 3a. the circuit's flight routes, both ways, Rs 15,000 per person (only those missing)
  with pairs(f, t) as (
    select 'Delhi', c from unnest(airports) c where c <> 'Delhi'
    union select c, 'Delhi' from unnest(airports) c where c <> 'Delhi'
    union select a, b from unnest(central) a, unnest(north_east || array['Bagdogra']) b
    union select b, a from unnest(central) a, unnest(north_east || array['Bagdogra']) b
    union select a, 'Bagdogra' from unnest(north_east) a
    union select 'Bagdogra', a from unnest(north_east) a
  )
  insert into public.sales_flight_routes (from_city, to_city, fare, sort)
  select p.f, p.t, 15000, 900
    from pairs p
   where not exists (select 1 from public.sales_flight_routes r where r.from_city ilike p.f and r.to_city ilike p.t);
  get diagnostics n_routes = row_count;

  -- 3b. Sales settings: the domestic fare for a flight with no route row (kept if already set)
  update public.sales_settings
     set data = coalesce(data, '{}'::jsonb) || '{"flight_fare_pp": 15000}'::jsonb
   where id = 1 and (data -> 'flight_fare_pp') is null;

  raise notice 'BAR rows marked foreign: %, Tadoba 60-120 rows added: %, flight routes added: %', n_bar, n_tadoba, n_routes;
end
$rules$;

notify pgrst, 'reload schema';

-- Check: what each rule now gives (expected: BAR rows foreign only; Tadoba 60-120 rows for every
-- Indian core validity; every circuit route at 15,000 unless set by hand; the setting at 15,000)
select '1. BAR rows, ' || coalesce(rr.nationality, 'all') as "What", p.name as "Item", count(*)::text as "Value"
  from public.sales_room_rates rr
  join public.sales_room_categories rc on rc.id = rr.room_category_id
  join public.sales_properties p on p.id = rc.property_id
 where coalesce(p.kind, 'own_lodge') = 'own_lodge' and rr.notes ilike '%per BAR policy%'
 group by 1, 2
union all
select '2. Tadoba Indian core ' || s.book_min_days || '-' || s.book_max_days || ' days', s.session || ' ' || s.valid_from || ' to ' || s.valid_to,
       s.weekday_rate || ' / ' || s.weekend_rate
  from public.sales_safari_rates s join public.sales_parks pk on pk.id = s.park_id
 where pk.name ilike 'tadoba%' and s.zone = 'core' and s.nationality = 'indian' and s.active
union all
select '3a. Flight route', r.from_city || ' -> ' || r.to_city, r.fare::text
  from public.sales_flight_routes r
union all
select '3b. Domestic flight fare (setting)', 'per person, one way', data ->> 'flight_fare_pp'
  from public.sales_settings where id = 1
order by 1, 2;
