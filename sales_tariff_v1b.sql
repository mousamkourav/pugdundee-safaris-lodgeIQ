-- =====================================================================
-- LodgeIQ Sales - columns for the merged code (safe to run at any time)
--   * the two add-on columns from the v2 changes that were never created
--     (sales_v2_itinerary_fixes.sql): included_guests, unavailable_weekdays
--   * "guests included" for the Tawa cruise and boat safari, copied into the
--     v2 column (the tariff script had used its own name, base_guests)
-- Safe to run more than once. Check the project ref before running.
-- =====================================================================
begin;
alter table public.sales_addons add column if not exists min_guests int;
alter table public.sales_addons add column if not exists included_guests int;
alter table public.sales_addons add column if not exists extra_guest_rate numeric(12,2);
alter table public.sales_addons add column if not exists unavailable_weekdays int[] not null default '{}';
alter table public.sales_addons add column if not exists availability_note text;

update public.sales_addons
set included_guests = base_guests
where included_guests is null
  and base_guests is not null;
commit;

notify pgrst, 'reload schema';

select 'add-ons with guests included' as what, count(*)::text as value from public.sales_addons where included_guests is not null and active
union all select 'v2 columns present', count(*)::text || ' of 5' from information_schema.columns
  where table_name = 'sales_addons' and column_name in ('min_guests', 'included_guests', 'extra_guest_rate', 'unavailable_weekdays', 'availability_note');
