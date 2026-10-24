-- =====================================================================
-- LodgeIQ Sales - switch room pricing to the Pugdundee tariff
-- RUN ONLY AFTER the merged code (lodgeiq-sales-step23b) is live on Vercel.
-- Removes the per-room rates the tariff replaces. They stay safe in
-- sales_room_rates_backup_v1 (sales_restore_room_rates_temp.sql puts them back).
-- Safe to run more than once. Check the project ref before running.
-- =====================================================================
delete from public.sales_room_rates r
using public.sales_room_categories rc
where rc.id = r.room_category_id
  and rc.rate_category_id is not null;

select 'per-room rates left (lodge exceptions)' as what, count(*)::text as value from public.sales_room_rates
union all select 'tariff rows in use', count(*)::text from public.sales_tariff where active
union all select 'old rates kept in the backup', count(*)::text from public.sales_room_rates_backup_v1;
