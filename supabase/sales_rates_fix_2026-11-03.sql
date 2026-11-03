-- =====================================================================
-- Rate corrections of 3 Nov 2026, each one proven by the owner's documents:
--  1. Safari breakfast for outside jeeps: Rs 1,000 for up to 2 guests + Rs 500 per further
--     guest, + 18% GST (all six BAR sheets 2026-27). Master data had Rs 1,000 flat.
--     (The code that charges the extra guests per jeep comes with the same deploy.)
--  2. Tadoba core, Indian guests, Rs 14,000 / Rs 18,500: the booking window 60-120 days was not
--     set (Waghoba BAR sheet: "if booked between 60-120 days"). Prices were already right; this
--     makes the row say so (and lets the Rate audit find it).
-- Nothing is added or deleted. Safe to run more than once (only rows still wrong are changed).
-- One statement (DO block) for the Supabase SQL Editor; the selects at the end show the result.
-- =====================================================================
do $fix$
declare n int;
begin
  update public.sales_addons
     set included_guests = 2, extra_guest_rate = 500
   where name ilike 'safari breakfast (outside jeeps)%'
     and active is not false
     and (included_guests is distinct from 2 or extra_guest_rate is distinct from 500);
  get diagnostics n = row_count;
  raise notice 'safari breakfast rows corrected: %', n;

  update public.sales_safari_rates r
     set book_min_days = 60, book_max_days = 120
    from public.sales_parks p
   where p.id = r.park_id and p.name ilike 'tadoba%'
     and r.zone = 'core' and r.nationality = 'indian' and r.active is not false
     and r.weekday_rate = 14000 and r.weekend_rate = 18500
     and r.book_min_days is null and r.book_max_days is null;
  get diagnostics n = row_count;
  raise notice 'Tadoba Indian 60-120 day rows corrected: %', n;
end
$fix$;

-- Check 1 (expected: Guests included 2, Each extra guest 500, Rate 1000, GST 18)
select name as "Add-on", rate as "Rate", included_guests as "Guests included", extra_guest_rate as "Each extra guest", tax_pct as "GST %"
from public.sales_addons
where name ilike 'safari breakfast (outside jeeps)%' and active is not false;

-- Check 2 (expected: Indian 14000 / 18500 with 60-120, Indian 11000 / 12000 with 4-59, for each session and season)
select r.session as "Session", r.nationality as "Guests", r.weekday_rate as "Weekday", r.weekend_rate as "Weekend",
       r.book_min_days as "Booked from (days)", r.book_max_days as "to (days)", r.valid_from as "Valid from", r.valid_to as "Valid to"
from public.sales_safari_rates r join public.sales_parks p on p.id = r.park_id
where p.name ilike 'tadoba%' and r.zone = 'core' and r.nationality = 'indian' and r.active is not false
order by r.valid_from, r.session, r.book_min_days;
