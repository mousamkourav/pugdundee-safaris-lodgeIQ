-- =====================================================================
-- Khajuraho rates for the itinerary builder (Radisson Hotel Jass Khajuraho)
--   * Room "Deluxe", B&B (CP) Rs 15,000 a night + 18% GST, 1 Oct 2026 - 30 Sep 2027
--   * Transfer Khajuraho Airport <-> Radisson, Rs 3,000 (Innova / Crysta)
--   * Transfer Kings Lodge <-> Radisson, Rs 11,500 + 5% GST, about 5.5 hours (Innova / Crysta)
--   * Add-ons at the Radisson: sightseeing Rs 6,000 per vehicle, guide Rs 5,000
--     per group, monument entrances Rs 1,500 per person
-- Safe to run more than once: nothing is added twice.
-- Change any rate later in Master data.
-- =====================================================================

-- the room
insert into sales_room_categories (property_id, name, max_adults, max_children, extra_bed, sort, active)
select p.id, 'Deluxe', 2, 1, true, 0, true
from sales_properties p
where p.name = 'Radisson Hotel Jass Khajuraho'
  and not exists (select 1 from sales_room_categories rc where rc.property_id = p.id);

-- the room rate (B&B)
insert into sales_room_rates (room_category_id, valid_from, valid_to, meal_plan, rate_double, min_nights, tax_pct, rates_include_tax, active)
select rc.id, '2026-10-01', '2027-09-30', 'CP', 15000, 1, 18, false, true
from sales_room_categories rc
join sales_properties p on p.id = rc.property_id
where p.name = 'Radisson Hotel Jass Khajuraho'
  and not exists (select 1 from sales_room_rates r where r.room_category_id = rc.id);

-- Khajuraho Airport <-> Radisson
insert into sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active)
select a.id, h.id, 'Innova / Crysta', 4, 3000, 0.5, 0, true, 0, true
from sales_locations a, sales_locations h
where a.name = 'Khajuraho Airport' and h.name = 'Radisson Hotel Jass Khajuraho'
  and not exists (
    select 1 from sales_transfer_rates t
    where (t.from_location_id = a.id and t.to_location_id = h.id) or (t.from_location_id = h.id and t.to_location_id = a.id)
  );

-- Kings Lodge <-> Radisson (by road, about 5.5 hours)
insert into sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active)
select k.id, h.id, 'Innova / Crysta', 4, 11500, 5.5, 0, true, 5, true
from sales_locations k, sales_locations h
where k.name = 'Kings Lodge' and h.name = 'Radisson Hotel Jass Khajuraho'
  and not exists (
    select 1 from sales_transfer_rates t
    where (t.from_location_id = k.id and t.to_location_id = h.id) or (t.from_location_id = h.id and t.to_location_id = k.id)
  );

-- experiences in Khajuraho (offered when the trip stays at the Radisson)
insert into sales_addons (name, property_id, pricing_unit, rate, tax_pct, active)
select x.name, p.id, x.unit, x.rate, 0, true
from sales_properties p
cross join (values
  ('Khajuraho sightseeing: vehicle, per day', 'per_vehicle', 6000),
  ('Khajuraho sightseeing: guide, per day', 'per_group', 5000),
  ('Khajuraho temple entrances', 'per_person', 1500)
) as x(name, unit, rate)
where p.name = 'Radisson Hotel Jass Khajuraho'
  and not exists (select 1 from sales_addons a where a.name = x.name);

notify pgrst, 'reload schema';

-- check: 6 rows, each with a rate
select 'room rate' as what, rc.name as item, r.rate_double as rate, r.tax_pct
from sales_room_rates r join sales_room_categories rc on rc.id = r.room_category_id join sales_properties p on p.id = rc.property_id
where p.name = 'Radisson Hotel Jass Khajuraho'
union all
select 'transfer', f.name || ' -> ' || t2.name, t.rate, t.tax_pct
from sales_transfer_rates t join sales_locations f on f.id = t.from_location_id join sales_locations t2 on t2.id = t.to_location_id
where t2.name = 'Radisson Hotel Jass Khajuraho' or f.name = 'Radisson Hotel Jass Khajuraho'
union all
select 'add-on', a.name, a.rate, a.tax_pct
from sales_addons a where a.name like 'Khajuraho %'
order by 1, 2;
