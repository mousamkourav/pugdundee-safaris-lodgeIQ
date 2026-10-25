-- =====================================================================
-- Sales: end date for the 2026-27 transfer rates (October 2026)
--
-- What it does: the 2026-27 transfer rates were saved without an end date,
-- so they covered every later date and the yearly hike never applied to
-- transfers after the season. This sets valid_to = 2027-09-30 on:
--   - transfer rates whose notes start with "Selling rate 2026-27", and
--   - transfer rates to or from a partner / city hotel
--     (properties of kind city_hotel or partner_lodge).
-- Only rows WITHOUT an end date are changed, so a date set by hand is kept
-- and running this twice changes nothing the second time.
--
-- When: any time (the new code works with or without it). Run in
-- Supabase > SQL Editor. The last select shows the rows it covers.
-- =====================================================================

begin;

update public.sales_transfer_rates t
   set valid_to = date '2027-09-30'
 where t.valid_to is null
   and (
        t.notes ilike 'Selling rate 2026-27%'
     or exists (
          select 1
            from public.sales_locations l
            join public.sales_properties p on p.id = l.property_id
           where l.id in (t.from_location_id, t.to_location_id)
             and p.kind in ('city_hotel', 'partner_lodge')
        )
   );

commit;

-- Check: every 2026-27 / partner hotel transfer rate with its dates.
-- valid_to should be 2027-09-30 (or the date you set by hand).
select fl.name as "from", tl.name as "to", t.vehicle_type, t.rate,
       t.valid_from, t.valid_to, t.notes, t.active
  from public.sales_transfer_rates t
  left join public.sales_locations fl on fl.id = t.from_location_id
  left join public.sales_locations tl on tl.id = t.to_location_id
 where t.notes ilike 'Selling rate 2026-27%'
    or exists (
         select 1
           from public.sales_locations l
           join public.sales_properties p on p.id = l.property_id
          where l.id in (t.from_location_id, t.to_location_id)
            and p.kind in ('city_hotel', 'partner_lodge')
       )
 order by t.valid_to nulls first, fl.name, tl.name, t.vehicle_type;
