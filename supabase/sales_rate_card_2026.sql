-- =====================================================================
-- Rates 2026-27 from the owner's documents (see lib/sales/master/rate-card.ts and
-- Master data > Rate audit, which shows what is still different after this runs)
--   1. Selling-rate card (road transfers, + 5% GST, one rate both ways), and Iora
--      Retreat's Guwahati / Jorhat transfers (+ 5% GST for now)
--   2. The roads "via" a place: add-ons at the lodges, the extra per vehicle
--   3. The Pugdundee tariff 2026-27 (foreign by season, Indian published), AP + 18%
--   4. The season calendar 2026-27 (only ranges that clash with nothing)
--   5. Safaris (existing rates of 2026-27 only): MP parks foreign and Indian for the
--      whole season, Tadoba foreign and Indian by booking window, Panna / Ken River
--      Lodge (all guests, taxes and naturalist included)
--   6. Experiences: Ken River Lodge B2B (taxes included), the foreigners' activity
--      rates (existing add-ons only), Tadoba supplements at Waghoba (Moharli gate,
--      modified Gypsy, Scorpio), partner hotel add-ons; 6b. Ken River Lodge rooms (B2B)
--   7. Partner hotel rooms: Roseate House, Agra, Jaipur (to 31 Mar 2027 / 1 Apr -
--      30 Sep 2027, B&B, + 18%) - existing rates corrected, missing ones added
-- Not changed here (the Rate audit page lists them): boat-safari price tiers, and
-- safari rates Master data has no row for (add them in Master data). 1 Jul - 30 Sep
-- 2027 has no season on purpose (owner, 31 Oct 2026).
-- Safe to run more than once: the second run changes nothing.
-- =====================================================================

begin;

-- Helper tables live in their own schema for this run only (the Supabase SQL Editor does
-- not keep temp tables between statements). A leftover from a failed run is removed first;
-- the schema is dropped again before the commit, so nothing of it stays.
drop schema if exists rate_card_tmp cascade;
create schema rate_card_tmp;

-- ---------------------------------------------------------------------
-- 1. road transfers
-- ---------------------------------------------------------------------
create table rate_card_tmp.card_road (park_from text, park_to text, vehicle text, rate numeric, a_id text, b_id text);
create table rate_card_tmp.card_place (name text, id text);

-- the lodges a park stands for
insert into rate_card_tmp.card_place (name, id)
select m.park, l.id::text
from (values
  ('Satpura', 'Denwa Backwater Escape'), ('Kanha', 'Kanha Earth Lodge'), ('Bandhavgarh', 'Kings Lodge'),
  ('Bandhavgarh', 'Tree House Hideaway'), ('Pench', 'Pench Tree Lodge'), ('Tadoba', 'Waghoba Eco Lodge'),
  ('Panna', 'Ken River Lodge'), ('Iora', 'Iora Retreat')
) as m(park, lodge)
join public.sales_properties p on p.name ilike m.lodge || '%' and p.active is not false
join public.sales_locations l on l.property_id = p.id and l.active is not false;

-- towns: the airport and / or the railway station, else one place by its name
insert into rate_card_tmp.card_place (name, id)
select distinct r.name, x.id::text
from (values
  ('Bhopal', 'Bhopal', 'airport'), ('Bhopal', 'Bhopal', 'railway'),
  ('Jabalpur', 'Jabalpur', 'airport'), ('Jabalpur', 'Jabalpur', 'railway'),
  ('Nagpur', 'Nagpur', 'airport'), ('Nagpur', 'Nagpur', 'railway'),
  ('Itarsi', 'Itarsi', 'railway'), ('Hoshangabad', 'Hoshangabad', 'railway'), ('Hoshangabad', 'Narmadapuram', 'railway'),
  ('Pipariya', 'Pipariya', 'railway'), ('Sohagpur', 'Sohagpur', 'any'), ('Pachmarhi', 'Pachmarhi', 'any'),
  ('Raipur Airport', 'Raipur', 'airport'), ('Katni', 'Katni', 'any'), ('Umaria', 'Umaria', 'any'),
  ('Khajuraho', 'Khajuraho', 'any'), ('Chandrapur station', 'Chandrapur', 'railway'),
  ('Guwahati Airport', 'Guwahati', 'airport'), ('Jorhat Airport', 'Jorhat', 'airport')
) as r(name, pattern, kind)
cross join lateral (
  select l.id from public.sales_locations l
  where l.type <> 'property' and l.active is not false and l.name ilike r.pattern || '%'
    and (r.kind = 'any' or l.type = r.kind)
  order by case l.type when 'airport' then 0 when 'railway' then 1 else 2 end, l.name
  limit 1
) x;

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
  ('Tadoba', 'Chandrapur station', 5000, 4000),
  -- Iora Retreat: Innova / Crysta only, + 5% GST for now
  ('Iora', 'Guwahati Airport', 13000, null),
  ('Iora', 'Jorhat Airport', 10000, null)
)
insert into rate_card_tmp.card_road (park_from, park_to, vehicle, rate, a_id, b_id)
select c.f, c.t, v.vehicle, v.rate, a.id, b.id
from card c
cross join lateral (values ('innova', c.innova), ('dzire', c.dzire)) as v(vehicle, rate)
join rate_card_tmp.card_place a on a.name = c.f
join rate_card_tmp.card_place b on b.name = c.t
where v.rate is not null;

-- the vehicle class of a rate; guests per vehicle as in Master data now (Innova 6, Dzire 3)
create table rate_card_tmp.card_vehicle (vehicle text, pattern text, fallback_name text, capacity int);
insert into rate_card_tmp.card_vehicle values ('innova', '(innova|crysta)', 'Innova / Crysta', 6), ('dzire', '(dzire|etios|sedan)', 'Dzire / Etios', 3);

-- a rate on the road for that vehicle: amount and GST as on the card
update public.sales_transfer_rates t
set rate = r.rate, tax_pct = 5
from rate_card_tmp.card_road r
join rate_card_tmp.card_vehicle v on v.vehicle = r.vehicle
where t.active is not false
  and (t.valid_to is null or t.valid_to >= current_date)
  and t.vehicle_type ~* v.pattern
  and ((t.from_location_id::text = r.a_id and t.to_location_id::text = r.b_id) or (t.from_location_id::text = r.b_id and t.to_location_id::text = r.a_id))
  and (t.rate <> r.rate or t.tax_pct is distinct from 5);

-- no rate on the road for that vehicle: add one (both ways), valid for the season
insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active, valid_to)
select a.id, b.id,
  coalesce((select x.vehicle_type from public.sales_transfer_rates x where x.vehicle_type ~* v.pattern group by x.vehicle_type order by count(*) desc limit 1), v.fallback_name),
  v.capacity, r.rate, null, 0, true, 5, true, date '2027-09-30'
from rate_card_tmp.card_road r
join rate_card_tmp.card_vehicle v on v.vehicle = r.vehicle
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

-- ---------------------------------------------------------------------
-- 2. roads "via" a place: an add-on at each lodge, the extra per vehicle (+ 5% GST).
--    Dzire / Etios via Bhimbetka is + 0 for now, so it has no add-on.
-- ---------------------------------------------------------------------
create table rate_card_tmp.card_via (via text, name text, lodge text, rate numeric);
insert into rate_card_tmp.card_via values
  ('Tawa Dam', 'Transfer via Tawa Dam (extra per vehicle)', 'Denwa Backwater Escape', 1500),
  ('Bedaghat', 'Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)', 'Kanha Earth Lodge', 1500),
  ('Bedaghat', 'Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)', 'Kings Lodge', 1500),
  ('Bedaghat', 'Transfer via Bedaghat / Dhuandhar Falls (extra per vehicle)', 'Tree House Hideaway', 1500),
  ('Bhimbetka', 'Transfer via Bhimbetka, Innova / Crysta (extra per vehicle)', 'Denwa Backwater Escape', 500);

update public.sales_addons a
set rate = v.rate, tax_pct = 5
from rate_card_tmp.card_via v
join public.sales_properties p on p.name ilike v.lodge || '%'
where a.property_id = p.id and a.active is not false and a.name ~* ('via\s+' || v.via)
  and (a.rate <> v.rate or a.tax_pct is distinct from 5);

insert into public.sales_addons (name, property_id, pricing_unit, rate, tax_pct, active)
select v.name, p.id, 'per_group', v.rate, 5, true
from rate_card_tmp.card_via v
join public.sales_properties p on p.name ilike v.lodge || '%' and p.active is not false
where not exists (select 1 from public.sales_addons a where a.property_id = p.id and a.name ~* ('via\s+' || v.via));

-- ---------------------------------------------------------------------
-- 3 and 4. the Pugdundee tariff and its season calendar (when the tariff tables exist)
-- ---------------------------------------------------------------------
do $tariff$
begin
  if to_regclass('public.sales_tariff') is null or to_regclass('public.sales_rate_categories') is null then
    raise notice 'No tariff tables: sections 3 and 4 skipped.';
    return;
  end if;

  create table rate_card_tmp.card_tariff (category text, nationality text, season text, single numeric, dbl numeric);
  insert into rate_card_tmp.card_tariff values
    ('cottage', 'foreign', 'shoulder', 15000, 18000), ('cottage', 'foreign', 'high', 18500, 22000), ('cottage', 'foreign', 'peak', 20000, 23000), ('cottage', 'indian', 'all', 27000, 30000),
    ('treehouse', 'foreign', 'shoulder', 17250, 21000), ('treehouse', 'foreign', 'high', 21000, 25500), ('treehouse', 'foreign', 'peak', 22000, 26500), ('treehouse', 'indian', 'all', 30000, 33000),
    ('forestsuite', 'foreign', 'shoulder', 19000, 23500), ('forestsuite', 'foreign', 'high', 22000, 26000), ('forestsuite', 'foreign', 'peak', 23000, 27500), ('forestsuite', 'indian', 'all', 33000, 37000),
    ('deluxeroom', 'foreign', 'shoulder', 13000, 16000), ('deluxeroom', 'foreign', 'high', 14000, 18000), ('deluxeroom', 'foreign', 'peak', 16000, 20000), ('deluxeroom', 'indian', 'all', 21000, 24000);

  -- the category by its name without spaces ("Tree House" = "Treehouse")
  create table rate_card_tmp.card_tariff_cat as
  select t.*, c.id::text as cat_id
  from rate_card_tmp.card_tariff t
  join public.sales_rate_categories c on lower(regexp_replace(c.name, '[^a-zA-Z0-9]', '', 'g')) = t.category and c.active is not false;

  -- rows of 2026-27: amounts, AP, + 18%; the dates too when it is the only row of that season
  update public.sales_tariff s
  set rate_double = k.dbl, rate_single = k.single, meal_plan = 'AP', tax_pct = 18, rates_include_tax = false,
      valid_from = case when k.n = 1 then date '2026-10-01' else s.valid_from end,
      valid_to = case when k.n = 1 then date '2027-09-30' else s.valid_to end
  from (
    select c.*, (select count(*) from public.sales_tariff x
                 where x.rate_category_id::text = c.cat_id and x.nationality = c.nationality and x.season = c.season and x.active is not false
                   and x.valid_from <= date '2027-09-30' and x.valid_to >= date '2026-10-01') as n
    from rate_card_tmp.card_tariff_cat c
  ) k
  where s.rate_category_id::text = k.cat_id and s.nationality = k.nationality and s.season = k.season and s.active is not false
    and s.valid_from <= date '2027-09-30' and s.valid_to >= date '2026-10-01'
    and (s.rate_double <> k.dbl or s.rate_single is distinct from k.single or s.meal_plan <> 'AP' or s.tax_pct is distinct from 18 or s.rates_include_tax is distinct from false
         or (k.n = 1 and (s.valid_from <> date '2026-10-01' or s.valid_to <> date '2027-09-30')));

  insert into public.sales_tariff (rate_category_id, nationality, season, valid_from, valid_to, rate_double, rate_single, meal_plan, tax_pct, rates_include_tax, active)
  select c.id, k.nationality, k.season, date '2026-10-01', date '2027-09-30', k.dbl, k.single, 'AP', 18, false, true
  from rate_card_tmp.card_tariff_cat k
  join public.sales_rate_categories c on c.id::text = k.cat_id
  where not exists (
    select 1 from public.sales_tariff x
    where x.rate_category_id::text = k.cat_id and x.nationality = k.nationality and x.season = k.season and x.active is not false
      and x.valid_from <= date '2027-09-30' and x.valid_to >= date '2026-10-01'
  );

  -- the season calendar 2026-27: a range is added only when no row of another season
  -- covers any of its dates (Peak and the long weekends win over a season anyway)
  if to_regclass('public.sales_tariff_calendar') is not null then
    insert into public.sales_tariff_calendar (calendar, season, date_from, date_to, label, active)
    select 'pugdundee', r.season, r.f, r.t, initcap(r.season) || ' 2026-27', true
    from (values
      ('shoulder', date '2026-10-01', date '2026-10-31'), ('high', date '2026-11-01', date '2026-11-30'),
      ('shoulder', date '2026-12-01', date '2026-12-20'), ('peak', date '2026-12-21', date '2027-01-04'),
      ('shoulder', date '2027-01-05', date '2027-01-31'), ('high', date '2027-02-01', date '2027-03-10'),
      ('peak', date '2027-03-10', date '2027-04-30'), ('high', date '2027-05-01', date '2027-05-15'),
      ('shoulder', date '2027-05-16', date '2027-06-30')
    ) as r(season, f, t)
    where not exists (
      select 1 from public.sales_tariff_calendar x
      where coalesce(x.calendar, 'pugdundee') = 'pugdundee' and x.active is not false
        and x.date_from <= r.t and x.date_to >= r.f
        and (x.season = r.season or (x.season <> 'peak' and r.season <> 'peak'))
    );
  end if;
end $tariff$;

-- ---------------------------------------------------------------------
-- 5. safaris (existing exclusive-jeep rates of 2026-27 only; missing ones: Rate audit)
-- ---------------------------------------------------------------------
-- Tadoba, foreign: core by booking window, buffer; naturalist 2,500; + 5%
update public.sales_safari_rates s
set weekday_rate = k.wd, weekend_rate = k.we, naturalist_fee = 2500, tax_pct = 5
from (values ('core', 4, 59, 11500, 12500), ('core', 60, 120, 14500, 19000), ('buffer', null, null, 13500, 14500)) as k(zone, bmin, bmax, wd, we),
     public.sales_parks p
where p.name ilike 'tadoba%' and s.park_id = p.id and s.zone = k.zone and s.nationality = 'foreign'
  and s.active is not false and s.vehicle_type ilike '%jeep%'
  and s.valid_from <= date '2026-12-15' and s.valid_to >= date '2026-12-15'
  and s.book_min_days is not distinct from k.bmin and s.book_max_days is not distinct from k.bmax
  and (s.weekday_rate <> k.wd or s.weekend_rate is distinct from k.we or s.naturalist_fee is distinct from 2500 or s.tax_pct is distinct from 5);

-- MP parks: foreign (naturalist 2,500) and Indian guests, for the whole 2026-27 season; + 5%.
-- Tadoba, Indian: core by booking window, buffer. (naturalist null = not changed)
update public.sales_safari_rates s
set weekday_rate = k.wd, weekend_rate = k.we, naturalist_fee = coalesce(k.nat, s.naturalist_fee), tax_pct = 5
from (values
  ('satpura', 'foreign', 'core', null::int, null::int, 16500, 17500, 2500), ('satpura', 'foreign', 'buffer', null, null, 14000, 14000, 2500),
  ('kanha', 'foreign', 'core', null, null, 17500, 18500, 2500), ('kanha', 'foreign', 'buffer', null, null, 15000, 15000, 2500),
  ('bandhavgarh', 'foreign', 'core', null, null, 17500, 18500, 2500), ('bandhavgarh', 'foreign', 'buffer', null, null, 15000, 15000, 2500),
  ('pench', 'foreign', 'core', null, null, 17500, 18500, 2500), ('pench', 'foreign', 'buffer', null, null, 15000, 15000, 2500),
  ('pench', 'indian', 'core', null, null, 14500, 15000, null), ('pench', 'indian', 'buffer', null, null, 13500, 13500, null),
  ('kanha', 'indian', 'core', null, null, 14500, 15000, null), ('kanha', 'indian', 'buffer', null, null, 13500, 13500, null),
  ('bandhavgarh', 'indian', 'core', null, null, 14500, 15000, null), ('bandhavgarh', 'indian', 'buffer', null, null, 13500, 13500, null),
  ('satpura', 'indian', 'core', null, null, 13500, 14000, null), ('satpura', 'indian', 'buffer', null, null, 12500, 12500, null),
  ('tadoba', 'indian', 'core', 4, 59, 11000, 12000, null), ('tadoba', 'indian', 'core', 60, 120, 14000, 18500, null),
  ('tadoba', 'indian', 'buffer', null, null, 13000, 14000, null)
) as k(park, nationality, zone, bmin, bmax, wd, we, nat),
     public.sales_parks p
where p.name ilike k.park || '%' and s.park_id = p.id and s.zone = k.zone and s.nationality = k.nationality
  and s.active is not false and s.vehicle_type ilike '%jeep%'
  and s.valid_from <= date '2026-12-15' and s.valid_to >= date '2026-12-15'
  and s.book_min_days is not distinct from k.bmin and s.book_max_days is not distinct from k.bmax
  and (s.weekday_rate <> k.wd or s.weekend_rate is distinct from k.we or (k.nat is not null and s.naturalist_fee is distinct from k.nat) or s.tax_pct is distinct from 5);

-- Panna (Ken River Lodge): 15,000 Mon-Fri / 16,000 Sat-Sun, all guests; entry, guide and
-- naturalist included, taxes included (no GST added)
update public.sales_safari_rates s
set weekday_rate = 15000, weekend_rate = 16000, naturalist_fee = 0, tax_pct = 0
from public.sales_parks p
where p.name ilike 'panna%' and s.park_id = p.id and s.zone = 'core'
  and s.active is not false and s.vehicle_type ilike '%jeep%'
  and s.valid_from <= date '2026-12-15' and s.valid_to >= date '2026-12-15'
  and (s.weekday_rate <> 15000 or s.weekend_rate is distinct from 16000 or s.naturalist_fee is distinct from 0 or s.tax_pct is distinct from 0);

-- ---------------------------------------------------------------------
-- 6. experiences
-- ---------------------------------------------------------------------
-- Ken River Lodge B2B (taxes included): the add-on whose name matches; added when missing.
-- "boat" is a boat safari that is not the night one (exclude = a word it must not have).
create table rate_card_tmp.card_krl (pattern text, exclude text, name text, unit text, rate numeric);
insert into rate_card_tmp.card_krl values
  ('boat', 'night', 'Boat safari (1.5 hours, up to 4 guests)', 'per_group', 5000),
  ('night.*boat|boat.*night', null, 'Night boat safari (2 hours, up to 4 guests)', 'per_group', 6000),
  ('fishing.*full|full.*fishing', null, 'Fishing, full day (morning + evening), max 2 guests', 'per_person', 7500),
  ('fishing.*half|half.*fishing', null, 'Fishing, half day, max 2 guests', 'per_person', 4500),
  ('bush dinner', null, 'Bush dinner', 'per_person', 3000),
  ('island dinner', null, 'Island dinner (per couple)', 'per_group', 15000),
  ('nature walk', null, 'Nature walk (per hour, max 2 guests)', 'per_group', 1500),
  ('cycl', null, 'Cycling (per hour)', 'per_group', 300),
  ('royal enfield|motor ?bike|motor cycle', null, 'Royal Enfield (per day)', 'per_group', 4000),
  ('dorm', null, 'Driver dormitory (night, 3 meals)', 'per_group', 2000);

update public.sales_addons a
set rate = k.rate, tax_pct = 0
from rate_card_tmp.card_krl k, public.sales_properties p
where p.name ilike 'ken river%' and a.property_id = p.id and a.active is not false
  and a.name ~* k.pattern and (k.exclude is null or a.name !~* k.exclude)
  and (a.rate <> k.rate or a.tax_pct is distinct from 0);

insert into public.sales_addons (name, property_id, pricing_unit, rate, tax_pct, active)
select k.name, p.id, k.unit, k.rate, 0, true
from rate_card_tmp.card_krl k
join public.sales_properties p on p.name ilike 'ken river%' and p.active is not false
where not exists (
  select 1 from public.sales_addons a
  where a.property_id = p.id and a.active is not false
    and a.name ~* k.pattern and (k.exclude is null or a.name !~* k.exclude)
);

-- the foreigners' activity rates: the foreign price of add-ons that exist; a lodge
-- without the add-on is listed on the Rate audit page
do $foreign$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_addons' and column_name = 'rate_foreign') then
    raise notice 'sales_addons has no rate_foreign column: the foreigners'' activity rates were skipped.';
    return;
  end if;
  update public.sales_addons a
  set rate_foreign = k.rate, tax_pct = k.tax
  from (values
    ('Denwa Backwater Escape', 'canoe', 4000, 5),
    ('Denwa Backwater Escape', 'buffer walk|walk.*buffer', 3000, 5),
    ('Kanha Earth Lodge', 'buffer walk|walk.*buffer', 3000, 5),
    ('Pench Tree Lodge', 'buffer walk|walk.*buffer', 3000, 5),
    (null, 'bush dinner|farm dinner', 4000, 18),
    (null, 'picnic lunch', 4000, 18),
    (null, 'culinary|cooking', 2500, 5),
    (null, 'escorted nature walk', 1500, 5),
    ('Waghoba Eco Lodge', 'boat.*(1\s*h|1\s*-?\s*hour|one hour)', 11000, 5),
    ('Waghoba Eco Lodge', 'boat.*(2\s*h|2\s*-?\s*hour|two hour)', 13000, 5)
  ) as k(lodge, pattern, rate, tax)
  where a.active is not false and a.name ~* k.pattern
    and (case when k.lodge is null
              -- a general activity: the add-on for all lodges, or one at an own lodge (not Ken River, which has its own rates)
              then a.property_id is null or exists (select 1 from public.sales_properties p where p.id = a.property_id and p.kind = 'own_lodge' and p.name not ilike 'ken river%')
              else exists (select 1 from public.sales_properties p where p.id = a.property_id and p.name ilike k.lodge || '%') end)
    and (a.rate_foreign is distinct from k.rate or a.tax_pct is distinct from k.tax);
end $foreign$;

-- Tadoba supplements at Waghoba Eco Lodge, per safari, all guests, + 5%: corrected, added only when missing
create table rate_card_tmp.card_wel (pattern text, exclude text, name text, rate numeric);
insert into rate_card_tmp.card_wel values
  ('moharli', null, 'Core safari from Moharli gate (extra per safari)', 4000),
  ('gypsy|modified', 'scorpio', 'Modified Gypsy (extra per safari)', 6000),
  ('scorpio', null, 'Modified Scorpio (extra per safari)', 9000);

update public.sales_addons a
set rate = k.rate, tax_pct = 5
from rate_card_tmp.card_wel k, public.sales_properties p
where p.name ilike 'waghoba%' and a.property_id = p.id and a.active is not false
  and a.name ~* k.pattern and (k.exclude is null or a.name !~* k.exclude)
  and (a.rate <> k.rate or a.tax_pct is distinct from 5);

insert into public.sales_addons (name, property_id, pricing_unit, rate, tax_pct, active)
select k.name, p.id, 'per_group', k.rate, 5, true
from rate_card_tmp.card_wel k
join public.sales_properties p on p.name ilike 'waghoba%' and p.active is not false
where not exists (
  select 1 from public.sales_addons a
  where a.property_id = p.id and a.active is not false
    and a.name ~* k.pattern and (k.exclude is null or a.name !~* k.exclude)
);

-- partner hotels' services (the add-on at that hotel whose name matches)
update public.sales_addons a
set rate = k.rate
from (values
  ('Roseate House', 'airport', 3000), ('Roseate House', 'innova|sight ?seeing', 8000),
  ('Roseate House', 'entrance|entry|monument', 2500), ('Roseate House', 'accompanying guide', 11000),
  ('Iora', 'camera', 500), ('Mayfair', 'airport', 3000),
  ('Radisson', 'sight ?seeing', 6000), ('Radisson', 'entrance|entry|ticket', 1500)
) as k(hotel, pattern, rate)
join public.sales_properties p on p.name ilike k.hotel || '%'
where a.property_id = p.id and a.active is not false and a.name ~* k.pattern and a.rate <> k.rate;

-- ---------------------------------------------------------------------
-- 6b. Ken River Lodge rooms: B2B 2026-27, AP, taxes included (existing rates only).
--     Weekday and weekend on the season's rate; a short row over Christmas (up to 16 days,
--     21 Dec - 4 Jan) or the category's Peak row is the long-weekend rate.
-- ---------------------------------------------------------------------
create table rate_card_tmp.card_krl_room (pattern text, exclude text, wd numeric, we numeric, lw numeric);
insert into rate_card_tmp.card_krl_room values
  ('stilted.*family|family.*stilted', null, 24000, 25000, 26000),
  ('stilted', 'family', 16500, 17500, 18500),
  ('premium hut|\mhut\M', null, 10500, 11500, 12500),
  ('family cottage', 'stilted', 18000, 20000, 22000),
  ('villa', null, 26000, 29000, 32000),
  ('mud house', null, 10500, 11500, 12500);

create table rate_card_tmp.card_krl_cat as
select c.id as room_id, k.*
from rate_card_tmp.card_krl_room k
join public.sales_properties p on p.name ilike 'ken river%'
join public.sales_room_categories c on c.property_id = p.id and c.name ~* k.pattern and (k.exclude is null or c.name !~* k.exclude);

-- the room's own rates
update public.sales_room_rates r
set rate_double = case when r.valid_to - r.valid_from <= 16 then k.lw else k.wd end,
    weekend_rate_double = case when r.valid_to - r.valid_from <= 16 then r.weekend_rate_double else k.we end,
    tax_pct = 0, rates_include_tax = true
from rate_card_tmp.card_krl_cat k
where r.room_category_id = k.room_id and r.active is not false
  and r.valid_from <= date '2027-09-30' and r.valid_to >= date '2026-10-01'
  and (r.rate_double <> case when r.valid_to - r.valid_from <= 16 then k.lw else k.wd end
       or (r.valid_to - r.valid_from > 16 and r.weekend_rate_double is distinct from k.we)
       or r.tax_pct is distinct from 0 or r.rates_include_tax is distinct from true);

-- or its tariff category (when rooms point to one)
do $krl$
begin
  if to_regclass('public.sales_tariff') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_room_categories' and column_name = 'rate_category_id') then
    return;
  end if;
  update public.sales_tariff t
  set rate_double = case when t.season = 'peak' then k.lw else k.wd end,
      weekend_rate_double = case when t.season = 'peak' then t.weekend_rate_double else k.we end,
      tax_pct = 0, rates_include_tax = true
  from rate_card_tmp.card_krl_cat k
  join public.sales_room_categories c on c.id = k.room_id
  where t.rate_category_id = c.rate_category_id and t.active is not false
    and t.valid_from <= date '2027-09-30' and t.valid_to >= date '2026-10-01'
    and (t.rate_double <> case when t.season = 'peak' then k.lw else k.wd end
         or (t.season <> 'peak' and t.weekend_rate_double is distinct from k.we)
         or t.tax_pct is distinct from 0 or t.rates_include_tax is distinct from true);
end $krl$;

-- ---------------------------------------------------------------------
-- 7. partner hotel rooms: B&B (CP), + 18% GST, to 31 Mar 2027 and 1 Apr - 30 Sep 2027
-- ---------------------------------------------------------------------
create table rate_card_tmp.card_room (hotel text, f date, t date, rate numeric);
insert into rate_card_tmp.card_room values
  ('Roseate House', '2026-10-01', '2027-03-31', 23000), ('Roseate House', '2027-04-01', '2027-09-30', 17000),
  ('DoubleTree', '2026-10-01', '2027-03-31', 20000), ('DoubleTree', '2027-04-01', '2027-09-30', 15000),
  ('Courtyard', '2026-10-01', '2027-03-31', 20000), ('Courtyard', '2027-04-01', '2027-09-30', 15000),
  ('ITC Mughal', '2026-10-01', '2027-03-31', 25000), ('ITC Mughal', '2027-04-01', '2027-09-30', 15000),
  ('ITC Rajputana', '2026-10-01', '2027-03-31', 25000), ('ITC Rajputana', '2027-04-01', '2027-09-30', 15000);

-- a CP rate that covers the middle of the period: amount and GST as on the document
update public.sales_room_rates r
set rate_double = k.rate, tax_pct = 18, rates_include_tax = false
from rate_card_tmp.card_room k
join public.sales_properties p on p.name ilike k.hotel || '%'
join public.sales_room_categories c on c.property_id = p.id
where r.room_category_id = c.id and r.active is not false and upper(r.meal_plan) in ('CP', 'B&B', 'BB')
  and r.valid_from <= k.f + (k.t - k.f) / 2 and r.valid_to >= k.f + (k.t - k.f) / 2
  and (r.rate_double <> k.rate or r.tax_pct is distinct from 18 or r.rates_include_tax is distinct from false);

-- no CP rate for the period: added for the hotel's first room (hotels with no room are listed below)
insert into public.sales_room_rates (room_category_id, valid_from, valid_to, meal_plan, rate_double, min_nights, tax_pct, rates_include_tax, active)
select c.id, k.f, k.t, 'CP', k.rate, 1, 18, false, true
from rate_card_tmp.card_room k
join public.sales_properties p on p.name ilike k.hotel || '%' and p.active is not false
cross join lateral (select rc.id from public.sales_room_categories rc where rc.property_id = p.id and rc.active is not false order by rc.name limit 1) c
where not exists (
  select 1 from public.sales_room_rates r
  join public.sales_room_categories rc on rc.id = r.room_category_id
  where rc.property_id = p.id and r.active is not false and upper(r.meal_plan) in ('CP', 'B&B', 'BB')
    and r.valid_from <= k.f + (k.t - k.f) / 2 and r.valid_to >= k.f + (k.t - k.f) / 2
);

-- check 1: every road on the card, for each vehicle, and what Master data has now
select r.park_from || ' - ' || r.park_to as road, a.name as from_place, b.name as to_place, r.vehicle, r.rate as card_rate,
  (select string_agg(t.rate::text || ' +' || coalesce(t.tax_pct, 0)::text || '%', ', ')
     from public.sales_transfer_rates t
     where t.active is not false and t.vehicle_type ~* v.pattern
       and ((t.from_location_id::text = r.a_id and t.to_location_id::text = r.b_id) or (t.from_location_id::text = r.b_id and t.to_location_id::text = r.a_id))) as in_master_data
from rate_card_tmp.card_road r
join rate_card_tmp.card_vehicle v on v.vehicle = r.vehicle
join public.sales_locations a on a.id::text = r.a_id
join public.sales_locations b on b.id::text = r.b_id
order by 1, 2, 3, 4;

drop schema rate_card_tmp cascade;

commit;

notify pgrst, 'reload schema';

-- check 2: places, lodges and hotels the documents name that Master data does not have
-- (their roads and rates were skipped)
select n.name as not_in_master_data
from (values ('Bhopal'), ('Pachmarhi'), ('Nagpur'), ('Itarsi'), ('Hoshangabad'), ('Pipariya'), ('Sohagpur'), ('Jabalpur'), ('Raipur'), ('Katni'), ('Umaria'), ('Khajuraho'), ('Chandrapur'), ('Guwahati'), ('Jorhat')) as n(name)
where not exists (select 1 from public.sales_locations l where l.type <> 'property' and l.active is not false and (l.name ilike n.name || '%' or (n.name = 'Hoshangabad' and l.name ilike 'Narmadapuram%')))
union all
select h.name from (values ('Denwa Backwater Escape'), ('Kanha Earth Lodge'), ('Kings Lodge'), ('Tree House Hideaway'), ('Pench Tree Lodge'), ('Waghoba Eco Lodge'), ('Ken River Lodge'), ('Iora Retreat'),
  ('Roseate House'), ('DoubleTree'), ('Courtyard'), ('ITC Mughal'), ('ITC Rajputana')) as h(name)
where not exists (select 1 from public.sales_properties p where p.name ilike h.name || '%' and p.active is not false)
union all
select h.name || ' (no room type)' from (values ('Roseate House'), ('DoubleTree'), ('Courtyard'), ('ITC Mughal'), ('ITC Rajputana')) as h(name)
where exists (select 1 from public.sales_properties p where p.name ilike h.name || '%')
  and not exists (select 1 from public.sales_room_categories c join public.sales_properties p on p.id = c.property_id where p.name ilike h.name || '%' and c.active is not false);

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
