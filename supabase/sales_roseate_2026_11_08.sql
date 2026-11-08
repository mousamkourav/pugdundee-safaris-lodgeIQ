-- =====================================================================
-- Roseate House (Delhi), B&B, 1 Oct 2026 - 31 Mar 2027: Rs 19,500 a room + 18% GST
-- (owner / G. Manager, 8 Nov 2026: the Rs 23,000 in Master data already had the 18% in it,
-- and the GST was added again on top: Rs 27,140 a night instead of Rs 23,010).
--   - only the Roseate House rate rows for that period that still say 23,000 change
--     (double and single); every other rate, period and hotel stays as it is
--   - 1 Apr - 30 Sep 2027 (Rs 17,000 + 18%) is not touched
--   - the rate tables have no change log of their own: this comment is the record
-- Also changed in the code: lib/sales/master/rate-card.ts and supabase/sales_rate_card_2026.sql
-- say 19,500, so the Rate audit and a re-run of the rate card agree.
--
-- HOW IT RUNS: one DO block (all or nothing). Safe to run more than once: the second run
-- changes nothing. The select at the end is the check.
-- EXPECTED RESULT (one row per Roseate House B&B rate of that period, normally one):
--   valid_from | valid_to   | rate_double | rate_single | tax_pct | rates_include_tax
--   2026-10-01 | 2027-03-31 | 19500       | 19500       | 18      | false
-- =====================================================================

do $roseate$
declare
  n int;
begin
  if to_regclass('public.sales_room_rates') is null then
    raise notice 'sales_room_rates not found: nothing changed';
    return;
  end if;

  update public.sales_room_rates r
  set rate_double = case when r.rate_double = 23000 then 19500 else r.rate_double end,
      rate_single = case when r.rate_single = 23000 then 19500 else r.rate_single end
  from public.sales_room_categories c
  join public.sales_properties p on p.id = c.property_id
  where r.room_category_id = c.id
    and p.name ilike 'Roseate House%'
    and r.active is not false
    and upper(r.meal_plan) in ('CP', 'B&B', 'BB')
    and r.valid_from <= date '2027-01-15' and r.valid_to >= date '2027-01-15'
    and (r.rate_double = 23000 or r.rate_single = 23000);
  get diagnostics n = row_count;
  raise notice 'Roseate House rate rows changed to 19,500: %', n;
end
$roseate$;

select r.valid_from, r.valid_to, r.rate_double, r.rate_single, r.tax_pct, r.rates_include_tax
from public.sales_room_rates r
join public.sales_room_categories c on c.id = r.room_category_id
join public.sales_properties p on p.id = c.property_id
where p.name ilike 'Roseate House%' and r.active is not false
  and upper(r.meal_plan) in ('CP', 'B&B', 'BB')
  and r.valid_from <= date '2027-01-15' and r.valid_to >= date '2027-01-15'
order by r.valid_from;
