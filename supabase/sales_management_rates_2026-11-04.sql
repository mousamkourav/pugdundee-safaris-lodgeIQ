-- =====================================================================
-- Management's rates sheet of 4 Nov 2026 (Pugdundee_rates_2026-11-03_2.xlsx), put into Master data.
-- Run AFTER the deploy of the same day is Ready (the app then reads the Indian calendar).
--  1. Room tariff, Indian nationals: seasonal rates (Shoulder / High / Peak) with weekend rates on
--     Friday and Saturday nights (owner, 4 Nov 2026), AP, + 18% GST, 1 Oct 2026 - 30 Sep 2027.
--     The four "published" all-year rows (30,000 / 24,000 / 37,000 / 33,000) become seasonal rows,
--     as in the sheet; the 8 missing seasons are added. Deluxe Room High is 23,500 as written.
--  2. Season calendar: a "Guests" column (all / Indian nationals). Indian nationals get their own
--     dates (High 1 Feb - 15 May with Holi 19 - 22 Mar as Peak). The rows for all guests (used by
--     foreign nationals): High to 10 Mar 2027, Peak from 11 Mar 2027 (was 9 / 10 Mar).
--  3. Tadoba core safaris: the booking window 4-59 days becomes 1-59 (Indian and foreign, both years).
--  4. The other changes in the sheet: transfers Kanha - Pench Dzire 7,500; Khajuraho Airport - Ken
--     River Innova 3,000; Khajuraho Airport - Radisson Innova 2,500; Waghoba - Nagpur Airport Dzire
--     7,000 / Innova 8,000; two inactive add-ons renamed (Kanha rooftop / poolside dinner; the old
--     foreign Tawa cruise row, 18,000).
-- Not taken from the sheet: the live Tawa cruise row renamed "... (Indian nationals)" - it also
-- carries the foreign price, so foreign guests would read "Indian nationals" on their quote.
-- Rows are found by their ids (from the sheet) or by category + guests + season, so it is safe to run
-- more than once. One statement (DO block) for the Supabase SQL Editor; the select at the end shows
-- the result.
-- =====================================================================
alter table public.sales_tariff add column if not exists weekend_days smallint[] not null default '{}';
alter table public.sales_tariff_calendar add column if not exists nationality text not null default 'all';

do $mgmt$
declare
  n int;
  r record;
  cat_id public.sales_rate_categories.id%type;
  base public.sales_tariff%rowtype;
begin
  -- the calendar's new column only takes all / indian / foreign
  if not exists (select 1 from pg_constraint where conname = 'sales_tariff_calendar_nationality_check') then
    alter table public.sales_tariff_calendar add constraint sales_tariff_calendar_nationality_check
      check (nationality in ('all', 'indian', 'foreign'));
  end if;

  -- 1a. the four published rows become the seasons the sheet gives them
  update public.sales_tariff set season = 'high'     where id = '4bee8247-9285-4fa6-9d67-82b2a9bf2189' and season = 'all'; -- Cottage
  update public.sales_tariff set season = 'high'     where id = 'b61cc787-0dbd-4813-80ef-314ac88c9cd8' and season = 'all'; -- Deluxe Room
  update public.sales_tariff set season = 'shoulder' where id = 'f5757a92-d3ff-4a4d-b154-8537fbe5697a' and season = 'all'; -- Forest Suite
  update public.sales_tariff set season = 'high'     where id = 'c35f7cf6-e53d-4a2c-91c9-b7bbfde0b32d' and season = 'all'; -- Tree House

  -- 1b. every Indian season: update it, or add it like the category's other Indian row
  n := 0;
  for r in
    select * from (values
      ('Cottage',      'shoulder', 16000, 13000, 17000, 14000),
      ('Cottage',      'high',     19500, 16500, 20500, 17500),
      ('Cottage',      'peak',     22000, 18500, 22000, 18500),
      ('Deluxe Room',  'shoulder', 14000, 11000, 15000, 12000),
      ('Deluxe Room',  'high',     23500, 20000, 25000, 21000),
      ('Deluxe Room',  'peak',     18000, 15000, 18000, 15000),
      ('Forest Suite', 'shoulder', 20500, 17000, 22000, 18000),
      ('Forest Suite', 'high',     23500, 20000, 25000, 21000),
      ('Forest Suite', 'peak',     26000, 22000, 26000, 22000),
      ('Tree House',   'shoulder', 18500, 15500, 20000, 16500),
      ('Tree House',   'high',     22000, 19000, 23500, 20000),
      ('Tree House',   'peak',     25000, 21000, 25000, 21000)
    ) as v(category, season, dbl, sgl, wk_dbl, wk_sgl)
  loop
    select id into cat_id from public.sales_rate_categories where name = r.category limit 1;
    if cat_id is null then
      raise exception 'Tariff category "%" not found: nothing changed', r.category;
    end if;
    update public.sales_tariff
       set rate_double = r.dbl, rate_single = r.sgl, weekend_rate_double = r.wk_dbl, weekend_rate_single = r.wk_sgl,
           weekend_days = '{5,6}', valid_from = date '2026-10-01', valid_to = date '2027-09-30',
           tax_pct = 18, rates_include_tax = false,
           notes = 'Tariff 2026-27: Indian nationals, ' || r.season || ' (management, 4 Nov 2026); weekend = Fri, Sat nights',
           active = true
     where rate_category_id = cat_id and nationality = 'indian' and season = r.season
       and valid_from <= date '2027-09-30' and valid_to >= date '2026-10-01';
    if not found then
      -- copy meal plan, extra adult and children rules, minimum nights from the category's Indian row
      select * into base from public.sales_tariff
       where rate_category_id = cat_id and nationality = 'indian' order by valid_from desc limit 1;
      if base.id is null then
        raise exception 'No Indian row for "%" to copy from: nothing changed', r.category;
      end if;
      base.id := gen_random_uuid();
      base.season := r.season;
      base.rate_double := r.dbl; base.rate_single := r.sgl;
      base.weekend_rate_double := r.wk_dbl; base.weekend_rate_single := r.wk_sgl;
      base.weekend_days := '{5,6}';
      base.valid_from := date '2026-10-01'; base.valid_to := date '2027-09-30';
      base.tax_pct := 18; base.rates_include_tax := false; base.active := true;
      base.notes := 'Tariff 2026-27: Indian nationals, ' || r.season || ' (management, 4 Nov 2026); weekend = Fri, Sat nights';
      insert into public.sales_tariff select base.*;
      n := n + 1;
    end if;
    base := null;
  end loop;
  raise notice '1. Indian tariff seasons added: % (the others updated)', n;

  -- 1c. no all-year Indian row left for these categories in 2026-27 (it would price Jul - Sep)
  update public.sales_tariff t set active = false
    from public.sales_rate_categories c
   where c.id = t.rate_category_id and c.name in ('Cottage', 'Deluxe Room', 'Forest Suite', 'Tree House')
     and t.nationality = 'indian' and t.season = 'all' and t.active is not false
     and t.valid_from <= date '2027-09-30' and t.valid_to >= date '2026-10-01';
  get diagnostics n = row_count;
  raise notice '1c. old all-year Indian rows switched off: %', n;

  -- 2a. the calendar for all guests: High to 10 Mar, Peak from 11 Mar 2027
  update public.sales_tariff_calendar set date_to = date '2027-03-10'
   where id = '694693da-64ea-4f13-8990-65715dd19546' and date_to = date '2027-03-09';
  update public.sales_tariff_calendar set date_from = date '2027-03-11'
   where id = 'bf825fc2-049f-487c-8a15-4a15d10079e6' and date_from = date '2027-03-10';

  -- 2b. the Indian nationals' calendar (Pugdundee lodges)
  insert into public.sales_tariff_calendar (calendar, nationality, season, date_from, date_to, label, active)
  select 'pugdundee', 'indian', v.season, v.f, v.t, v.label, true
  from (values
    ('shoulder', date '2026-10-01', date '2026-10-31', null),
    ('peak',     date '2026-10-17', date '2026-10-20', 'Dussehra long weekend'),
    ('high',     date '2026-11-01', date '2026-11-30', null),
    ('peak',     date '2026-11-06', date '2026-11-14', 'Diwali long weekend'),
    ('shoulder', date '2026-12-01', date '2026-12-20', null),
    ('peak',     date '2026-12-21', date '2027-01-04', 'Christmas and New Year'),
    ('shoulder', date '2027-01-05', date '2027-01-31', null),
    ('high',     date '2027-02-01', date '2027-05-15', null),
    ('peak',     date '2027-03-19', date '2027-03-22', 'Holi long weekend'),
    ('shoulder', date '2027-05-16', date '2027-06-30', null)
  ) as v(season, f, t, label)
  where not exists (
    select 1 from public.sales_tariff_calendar x
     where x.calendar = 'pugdundee' and x.nationality = 'indian' and x.season = v.season
       and x.date_from = v.f and x.date_to = v.t);
  get diagnostics n = row_count;
  raise notice '2. Indian calendar ranges added: %', n;

  -- 3. Tadoba core: booked 1-59 days ahead (was 4-59)
  update public.sales_safari_rates sr set book_min_days = 1
    from public.sales_parks p
   where p.id = sr.park_id and p.name ilike 'tadoba%' and sr.zone = 'core'
     and sr.book_min_days = 4 and sr.book_max_days = 59;
  get diagnostics n = row_count;
  raise notice '3. Tadoba rows set to 1-59 days: %', n;

  -- 4. the other changes in the sheet (by id; only while still different)
  update public.sales_transfer_rates set rate = 7500 where id = 'f9bf85e6-07d0-4278-846e-4e216c2b681d' and rate is distinct from 7500; -- Kanha - Pench, Dzire
  update public.sales_transfer_rates set rate = 3000 where id = 'c71cc745-46f4-4862-89dd-25cb98339222' and rate is distinct from 3000; -- Khajuraho Airport - Ken River, Innova
  update public.sales_transfer_rates set rate = 2500 where id = 'eedfceab-f14d-4673-9f41-39a05e2d57cc' and rate is distinct from 2500; -- Khajuraho Airport - Radisson, Innova
  update public.sales_transfer_rates set rate = 7000 where id = 'b4acf44a-6a86-4b3b-abef-d565bbb86d2f' and rate is distinct from 7000; -- Waghoba - Nagpur Airport, Dzire
  update public.sales_transfer_rates set rate = 8000 where id = '65332951-5773-4880-a3a5-fb0d08535fa1' and rate is distinct from 8000; -- Waghoba - Nagpur Airport, Innova
  update public.sales_addons set name = 'Rooftop / poolside dinner experience'
   where id = '5113a10b-d16a-49ed-8217-05f6ee1e9525' and name is distinct from 'Rooftop / poolside dinner experience';
  update public.sales_addons set name = 'Tawa cruise to the lodge by boat for 2 guests (foreign nationals)', rate = 18000
   where id = 'cd9874e1-b95e-4e57-b229-1b4feeae1318' and (rate is distinct from 18000 or name not like '%for 2 guests%');
  raise notice '4. transfers and add-ons checked';
end
$mgmt$;

notify pgrst, 'reload schema';

-- Check (one table). Expected:
--   12 "Indian tariff" rows: the rates above, weekend {5,6}, + 18%, 2026-10-01 to 2027-09-30
--   10 "Indian calendar" rows; "All-guests calendar" High to 2027-03-10 and Peak from 2027-03-11
--   "Tadoba core window": 1-59 and 60-120 only
--   5 "Transfer" rows: 7500, 3000, 2500, 7000, 8000
--   "Ken River weekend nights": the nights its weekend rates use (tell Claude what it shows)
select 'Indian tariff' as "What", c.name || ', ' || t.season as "Item",
       t.rate_double || ' / single ' || coalesce(t.rate_single::text, '-') || ', weekend ' || coalesce(t.weekend_rate_double::text, '-') || ' / ' || coalesce(t.weekend_rate_single::text, '-')
         || ' on ' || t.weekend_days::text || ', + ' || t.tax_pct || '%, ' || t.valid_from || ' to ' || t.valid_to as "Value"
from public.sales_tariff t join public.sales_rate_categories c on c.id = t.rate_category_id
where t.nationality = 'indian' and t.active is not false
union all
select 'Indian calendar', x.season, x.date_from || ' to ' || x.date_to || coalesce(' (' || x.label || ')', '')
from public.sales_tariff_calendar x where x.nationality = 'indian' and x.active is not false
union all
select 'All-guests calendar', x.season, x.date_from || ' to ' || x.date_to
from public.sales_tariff_calendar x
where x.nationality = 'all' and x.calendar = 'pugdundee' and x.active is not false and x.date_from between date '2027-02-01' and date '2027-04-30'
union all
select distinct 'Tadoba core window', r.nationality, r.book_min_days || '-' || r.book_max_days
from public.sales_safari_rates r join public.sales_parks p on p.id = r.park_id
where p.name ilike 'tadoba%' and r.zone = 'core' and r.active is not false and r.book_min_days is not null
union all
select 'Transfer', a.name || ' - ' || b.name || ', ' || tr.vehicle_type, tr.rate::text
from public.sales_transfer_rates tr
join public.sales_locations a on a.id = tr.from_location_id join public.sales_locations b on b.id = tr.to_location_id
where tr.id in ('f9bf85e6-07d0-4278-846e-4e216c2b681d', 'c71cc745-46f4-4862-89dd-25cb98339222', 'eedfceab-f14d-4673-9f41-39a05e2d57cc',
                'b4acf44a-6a86-4b3b-abef-d565bbb86d2f', '65332951-5773-4880-a3a5-fb0d08535fa1')
union all
select distinct 'Ken River weekend nights', c.name, t.weekend_days::text
from public.sales_tariff t join public.sales_rate_categories c on c.id = t.rate_category_id
where c.name ilike 'ken river%' and t.weekend_rate_double is not null and t.active is not false
order by 1, 2, 3;
