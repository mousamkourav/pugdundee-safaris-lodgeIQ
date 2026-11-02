-- =====================================================================
-- Indian guests at our own lodges: the published Indian rate again (audit of 2 Nov 2026).
--
-- WHAT IS WRONG: each own lodge still has its old seasonal room rates in Master data > Room
-- rates ("... per BAR policy", the foreign BAR prices). They are lodge exceptions (priority 10)
-- for "all guests", so they beat the Pugdundee tariff, and Indian guests are quoted the
-- foreign BAR rate (Pench AC Cottage in Feb: Rs 22,000 for two instead of the Indian Rs 30,000).
-- Master data > Overview now warns about it on each room.
--
-- WHAT THIS DOES: those "per BAR policy" rows of our own lodges are marked for FOREIGN guests
-- (their prices are the foreign tariff's, so foreign quotes do not change). Indian guests then
-- get the Indian published rate of the tariff. Nothing is deleted. Ken River and the rows of the
-- rate documents ("new tariff from 1 Jul 2027") are NOT touched.
--
-- RUN ONLY IF Indian guests must pay the published Indian rate (as the tariff says). If the BAR
-- rates were meant for every guest, do not run it, and tell us.
--
-- HOW IT RUNS: one statement (a DO block) for the Supabase SQL Editor; all or nothing.
-- Safe to run more than once (a row already marked foreign is left as it is).
-- The builder reads Master data from a 5-minute cache: new quotes use the change within 5 minutes.
-- =====================================================================

do $fix$
declare
  n int;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sales_room_rates' and column_name = 'nationality') then
    raise exception 'sales_room_rates has no nationality column: run the tariff SQL (sales_rate_card_2026.sql) first.';
  end if;

  update public.sales_room_rates rr
     set nationality = 'foreign'
    from public.sales_room_categories rc
    join public.sales_properties p on p.id = rc.property_id
   where rr.room_category_id = rc.id
     and coalesce(p.kind, 'own_lodge') = 'own_lodge'
     and coalesce(rr.nationality, 'all') = 'all'
     and rr.notes ilike '%per BAR policy%';
  get diagnostics n = row_count;
  raise notice 'rows marked for foreign guests: %', n;
end
$fix$;

notify pgrst, 'reload schema';

-- Check: our own lodges' "per BAR policy" rows by nationality (expected: foreign only)
select p.name as "Lodge", coalesce(rr.nationality, 'all') as "Guests", count(*) as "Rows",
       min(rr.valid_from) as "From", max(rr.valid_to) as "To"
from public.sales_room_rates rr
join public.sales_room_categories rc on rc.id = rr.room_category_id
join public.sales_properties p on p.id = rc.property_id
where coalesce(p.kind, 'own_lodge') = 'own_lodge' and rr.notes ilike '%per BAR policy%'
group by 1, 2
order by 1, 2;
