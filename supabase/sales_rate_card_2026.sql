-- =====================================================================
-- Selling-rate card 2025-26 / 2026-27: road transfers, + 5% GST, one rate both ways
--   * 30 roads x 2 vehicles (Innova / Crysta and Dzire / Etios). The 3 roads "via"
--     a place (Bhimbetka, Tawa Dam, Bedaghat) are NOT loaded: a question for the owner.
--   * Park names stand for our lodges: Satpura = Denwa Backwater Escape, Kanha = Kanha
--     Earth Lodge, Bandhavgarh = Kings Lodge and Tree House Hideaway, Pench = Pench Tree
--     Lodge, Tadoba = Waghoba Eco Lodge, Panna = Ken River Lodge.
--   * Towns: the airport of that town if Master data has one, else its railway station,
--     else the place with that name ("Chandrapur station": the station first).
--   * A rate on the road for that vehicle (either direction, still valid): its amount
--     and GST are corrected to the card. No rate: one is added (capacity copied from
--     the vehicle's other rates, else 4 / 3). Roads whose places are not in Master data
--     are skipped and listed by the check at the end.
-- Safe to run more than once: the second run changes nothing.
-- Also at the end (read only): the city hotels named twice and the Roseate House /
-- Radisson rates, to find why a city-hotel night was not priced.
-- =====================================================================

begin;

create temp table card_road (park_from text, park_to text, vehicle text, rate numeric, a_id text, b_id text) on commit drop;

with card(f, t, innova, dzire) as (values
  ('Satpura', 'Bhopal', 9000, 7000),
  ('Satpura', 'Pachmarhi', 10500, 9000),
  ('Satpura', 'Nagpur', 12500, 10000),
  ('Satpura', 'Itarsi', 7000, 5500),
  ('Satpura', 'Hoshangabad', 7000, 5500),
  ('Satpura', 'Pipariya', 7000, 5500),
  ('Satpura', 'Sohagpur', 6000, 5000),
  ('Kanha', 'Nagpur', 11000, 9000),
  ('Kanha', 'Jabalpur', 9000, 7500),
  ('Kanha', 'Raipur Airport', 10000, 8000),
  ('Kanha', 'Pench', 9000, 8000),
  ('Kanha', 'Bandhavgarh', 11000, 9500),
  ('Kanha', 'Satpura', 15500, 11500),
  ('Bandhavgarh', 'Jabalpur', 9000, 7000),
  ('Bandhavgarh', 'Katni', 5000, 4000),
  ('Bandhavgarh', 'Umaria', 4000, 3500),
  ('Bandhavgarh', 'Panna', 9500, 7500),
  ('Bandhavgarh', 'Pench', 15000, 11500),
  ('Bandhavgarh', 'Khajuraho', 11000, 9000),
  ('Pench', 'Nagpur', 9000, 7000),
  ('Pench', 'Satpura', 11500, 9000),
  ('Pench', 'Jabalpur', 9500, 7500),
  ('Pench', 'Kanha', 9000, 8000),
  ('Pench', 'Bandhavgarh', 15500, 11500),
  ('Pench', 'Tadoba', 11000, 9000),
  ('Tadoba', 'Nagpur', 7500, 6500),
  ('Tadoba', 'Satpura', 16500, 13000),
  ('Tadoba', 'Pench', 11000, 9000),
  ('Tadoba', 'Chandrapur station', 5000, 4000)
),
lodge_map(park, lodge) as (values
  ('Satpura', 'Denwa Backwater Escape'),
  ('Kanha', 'Kanha Earth Lodge'),
  ('Bandhavgarh', 'Kings Lodge'),
  ('Bandhavgarh', 'Tree House Hideaway'),
  ('Pench', 'Pench Tree Lodge'),
  ('Tadoba', 'Waghoba Eco Lodge'),
  ('Panna', 'Ken River Lodge')
),
ends as (
  select c.f, c.t, v.vehicle, v.rate
  from card c cross join lateral (values ('innova', c.innova), ('dzire', c.dzire)) as v(vehicle, rate)
),
-- every place a card name stands for: the lodges of a park, else one airport / station / place
place(name, id) as (
  select n.name, x.id::text
  from (select distinct f as name from card union select distinct t from card) n
  cross join lateral (
    select l.id from public.sales_locations l
    join public.sales_properties p on p.id = l.property_id
    join lodge_map m on m.lodge = p.name
    where m.park = n.name and l.active is not false and p.active is not false
    union all
    select y.id from (
      select l.id from public.sales_locations l
      where not exists (select 1 from lodge_map m where m.park = n.name)
        and l.type <> 'property' and l.active is not false
        and l.name ilike regexp_replace(n.name, '\s+(airport|station)$', '', 'i') || '%'
      order by case
        when n.name ilike '%station' then (case l.type when 'railway' then 0 when 'airport' then 1 else 2 end)
        else (case l.type when 'airport' then 0 when 'railway' then 1 else 2 end) end,
        l.name
      limit 1
    ) y
  ) x
)
insert into card_road (park_from, park_to, vehicle, rate, a_id, b_id)
select e.f, e.t, e.vehicle, e.rate, a.id, b.id
from ends e
join place a on a.name = e.f
join place b on b.name = e.t;

-- the vehicle class of a rate
create temp table card_vehicle (vehicle text, pattern text, fallback_name text, fallback_capacity int) on commit drop;
insert into card_vehicle values ('innova', '(innova|crysta)', 'Innova / Crysta', 4), ('dzire', '(dzire|etios|sedan)', 'Dzire / Etios', 3);

-- 1) a rate on the road for that vehicle: amount and GST as on the card
update public.sales_transfer_rates t
set rate = r.rate, tax_pct = 5
from card_road r
join card_vehicle v on v.vehicle = r.vehicle
where t.active is not false
  and (t.valid_to is null or t.valid_to >= current_date)
  and t.vehicle_type ~* v.pattern
  and ((t.from_location_id::text = r.a_id and t.to_location_id::text = r.b_id) or (t.from_location_id::text = r.b_id and t.to_location_id::text = r.a_id))
  and (t.rate <> r.rate or t.tax_pct is distinct from 5);

-- 2) no rate on the road for that vehicle: add one (both ways)
insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active, valid_to)
select a.id, b.id,
  coalesce((select x.vehicle_type from public.sales_transfer_rates x where x.vehicle_type ~* v.pattern group by x.vehicle_type order by count(*) desc limit 1), v.fallback_name),
  coalesce((select x.capacity from public.sales_transfer_rates x where x.vehicle_type ~* v.pattern group by x.capacity order by count(*) desc limit 1), v.fallback_capacity),
  r.rate, null, 0, true, 5, true, date '2027-09-30' -- the card's season, like the other transfer rates
from card_road r
join card_vehicle v on v.vehicle = r.vehicle
join public.sales_locations a on a.id::text = r.a_id
join public.sales_locations b on b.id::text = r.b_id
where r.a_id <> r.b_id
  and not exists (
    select 1 from public.sales_transfer_rates t
    where t.active is not false
      and (t.valid_to is null or t.valid_to >= current_date)
      and t.vehicle_type ~* v.pattern
      and ((t.from_location_id::text = r.a_id and t.to_location_id::text = r.b_id) or (t.from_location_id::text = r.b_id and t.to_location_id::text = r.a_id))
  );

-- check 1: every road on the card, for each vehicle: OK, or why not
select r.park_from || ' - ' || r.park_to as road, a.name as from_place, b.name as to_place, r.vehicle, r.rate as card_rate,
  (select string_agg(t.rate::text || ' +' || coalesce(t.tax_pct, 0)::text || '%', ', ')
     from public.sales_transfer_rates t
     where t.active is not false and t.vehicle_type ~* v.pattern
       and ((t.from_location_id::text = r.a_id and t.to_location_id::text = r.b_id) or (t.from_location_id::text = r.b_id and t.to_location_id::text = r.a_id))) as in_master_data
from card_road r
join card_vehicle v on v.vehicle = r.vehicle
join public.sales_locations a on a.id::text = r.a_id
join public.sales_locations b on b.id::text = r.b_id
order by 1, 2, 3, 4;

commit;

notify pgrst, 'reload schema';

-- check 2: card places Master data does not have (these roads were skipped)
select n.name as place_not_in_master_data
from (values ('Bhopal'), ('Pachmarhi'), ('Nagpur'), ('Itarsi'), ('Hoshangabad'), ('Pipariya'), ('Sohagpur'), ('Jabalpur'), ('Raipur'), ('Katni'), ('Umaria'), ('Khajuraho'), ('Chandrapur')) as n(name)
where not exists (select 1 from public.sales_locations l where l.type <> 'property' and l.active is not false and l.name ilike n.name || '%')
union all
select lodge from (values ('Denwa Backwater Escape'), ('Kanha Earth Lodge'), ('Kings Lodge'), ('Tree House Hideaway'), ('Pench Tree Lodge'), ('Waghoba Eco Lodge'), ('Ken River Lodge')) as m(lodge)
where not exists (select 1 from public.sales_locations l join public.sales_properties p on p.id = l.property_id where p.name = m.lodge);

-- check 3 (read only): hotels named more than once, and the Roseate House / Radisson rates
-- (hotel row, room, meal plan, dates, nationality, GST) - a city-hotel night is priced from these
select p.name as hotel, p.kind, p.active as hotel_active, c.name as room, c.active as room_active,
  r.meal_plan, r.valid_from, r.valid_to, coalesce(to_jsonb(r)->>'nationality', 'all') as nationality, r.rate_double, r.tax_pct, r.rates_include_tax, r.active as rate_active,
  (select count(*) from public.sales_properties q where lower(q.name) = lower(p.name)) as rows_with_this_name
from public.sales_properties p
left join public.sales_room_categories c on c.property_id = p.id
left join public.sales_room_rates r on r.room_category_id = c.id
where p.name ilike '%roseate%' or p.name ilike '%radisson%'
   or lower(p.name) in (select lower(name) from public.sales_properties group by lower(name) having count(*) > 1)
order by p.name, p.id, c.name, r.valid_from;
