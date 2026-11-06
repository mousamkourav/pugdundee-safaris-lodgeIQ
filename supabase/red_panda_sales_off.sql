-- =====================================================================
-- Red Panda only in the Red Panda tab (owner, 6 Nov 2026).
-- Switches OFF what supabase/red_panda_in_sales.sql added to Sales Master data, so the Sales builder
-- no longer offers Red Panda Outpost (Red Panda quotes, with Delhi before / after, are made only in
-- the Red Panda tab, by people with Red Panda access):
--   * the lodge "Red Panda Outpost", its room, its place, its roads, its day texts and includes
--   * the park "Singalila National Park"
--   * the reader rule "redpanda"
-- Nothing is deleted (set inactive / rejected): it can be switched on again in Master data.
-- Bhadrapur Airport stays (a place, harmless). Rows that were never added: nothing happens.
-- Safe to run more than once, before or after the deploy.
-- One DO block for the Supabase SQL Editor; the select at the end shows the result.
-- =====================================================================
do $off$
declare
  v_prop uuid[];
  v_locs uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_prop from public.sales_properties where name ilike 'red panda outpost%';
  select coalesce(array_agg(id), '{}') into v_locs from public.sales_locations where property_id = any (v_prop);

  update public.sales_properties set active = false where id = any (v_prop) and active is distinct from false;
  update public.sales_room_categories set active = false where property_id = any (v_prop) and active is distinct from false;
  update public.sales_locations set active = false where id = any (v_locs) and active is distinct from false;
  update public.sales_transfer_rates set active = false
    where (from_location_id = any (v_locs) or to_location_id = any (v_locs)) and active is distinct from false;
  update public.sales_content_blocks set active = false where property_id = any (v_prop) and active is distinct from false;
  update public.sales_parks set active = false where name ilike 'singalila%' and active is distinct from false;
  if to_regclass('public.sales_reader_rules') is not null then
    update public.sales_reader_rules set status = 'rejected' where lower(btrim(phrase)) = 'redpanda' and meaning ilike 'red panda outpost%' and status <> 'rejected';
  end if;
end
$off$;

notify pgrst, 'reload schema';

-- Check (expected: all 0 = nothing of Red Panda left switched on in Sales Master data)
select
  (select count(*) from public.sales_properties where name ilike 'red panda outpost%' and active) as lodge_on,
  (select count(*) from public.sales_parks where name ilike 'singalila%' and active) as park_on,
  (select count(*) from public.sales_transfer_rates t join public.sales_locations l on l.id in (t.from_location_id, t.to_location_id)
     join public.sales_properties p on p.id = l.property_id where p.name ilike 'red panda outpost%' and t.active) as roads_on,
  (select count(*) from public.sales_content_blocks b join public.sales_properties p on p.id = b.property_id where p.name ilike 'red panda outpost%' and b.active) as texts_on;
