-- =====================================================================
-- Red Panda Outpost in Sales trips (6 Nov 2026): Delhi - Red Panda - Kaziranga, or any mix.
-- Run AFTER supabase/red_panda.sql (it reads the good-to-know text from rp_settings).
-- Adds to Sales Master data, so the Sales builder can plan and price it like a lodge:
--   * park "Singalila National Park" (no safari rates: no jeep safaris are planned there)
--   * lodge "Red Panda Outpost" (own lodge, park Singalila), its place, one room "Twin room"
--     (2 per room). NO room rates: the app prices its nights from the Red Panda tariff
--     (Red Panda > Master data), per person by group size, pro rata per night, + GST 5%.
--   * place "Bhadrapur Airport" (BDP, Nepal)
--   * roads to the Outpost at Rs 0 (the transfer is in the Red Panda package), 4x4 Bolero:
--     Bagdogra Airport 5 h, Bhadrapur Airport 3.5 h, Mayfair Chumta (Siliguri) 5 h
--   * day texts for the Outpost (arrival, arriving from another stop, a day there, departure),
--     its includes, does not include and good to know (the same as the Red Panda page)
--   * a reader rule: "redpanda" (one word) = Red Panda Outpost
-- Flights Delhi - Bagdogra and Bagdogra - Guwahati / Jorhat are NOT added: their fares are not in
-- the documents. Add them in Sales > Master data > Flight routes; until then the builder asks for
-- the fare ("price needed").
-- Safe to run more than once: nothing is added twice, nothing is deleted or changed.
-- One DO block for the Supabase SQL Editor; the select at the end shows the result.
-- =====================================================================
do $rp$
declare
  v_park uuid;
  v_prop uuid;
  v_loc uuid;
  v_gtk text;
begin
  -- ---------------------------------------------------------------- park
  insert into public.sales_parks (name, state, short_desc, long_desc, season_notes, sort, active)
  select 'Singalila National Park', 'Nepal / West Bengal',
    'Rhododendron and bamboo forests on the India - Nepal border, home of the elusive red panda and over 350 species of birds.',
    'Red Panda Outpost lies in Jaubari, a small Buddhist village at 9,400 ft adjoining Singalila National Park. Expert trackers look for fresh signs of the red panda in the contiguous forests of Nepal and India every morning; guests then walk in with a naturalist. A moderate level of fitness is needed.',
    'Red Panda Outpost is closed June to September (monsoon).', 0, true
  where not exists (select 1 from public.sales_parks where name ilike 'singalila%');
  select id into v_park from public.sales_parks where name ilike 'singalila%' order by name limit 1;

  -- ---------------------------------------------------------------- lodge
  insert into public.sales_properties (name, kind, park_id, city, short_desc, long_desc, fallback_priority, active)
  select 'Red Panda Outpost', 'own_lodge', v_park, null,
    'An eco-tourism homestay at 9,400 ft in Jaubari, Nepal, adjoining Singalila National Park.',
    'Once a humble teahouse run by a local Gorkha family, Red Panda Outpost has been reimagined as a homestay: five rooms with attached bathrooms, heating, hot water and wholesome food made with fresh, seasonal ingredients. Guests gather every evening around a bukhari fire in the old wooden house.',
    100, true
  where not exists (select 1 from public.sales_properties where name ilike 'red panda outpost%');
  select id into v_prop from public.sales_properties where name ilike 'red panda outpost%' order by name limit 1;

  -- its place (the app does this when a lodge is saved)
  insert into public.sales_locations (type, name, property_id, active)
  select 'property', 'Red Panda Outpost', v_prop, true
  where not exists (select 1 from public.sales_locations where property_id = v_prop);
  select id into v_loc from public.sales_locations where property_id = v_prop order by name limit 1;

  -- the room (2 per room, twin beds); no rates: priced from the Red Panda tariff
  insert into public.sales_room_categories (property_id, name, max_adults, max_children, extra_bed, sort, active)
  select v_prop, 'Twin room', 2, 1, false, 0, true
  where not exists (select 1 from public.sales_room_categories where property_id = v_prop);

  -- ---------------------------------------------------------------- Bhadrapur Airport
  insert into public.sales_locations (type, name, code, state, active)
  select 'airport', 'Bhadrapur Airport', 'BDP', 'Koshi, Nepal', true
  where not exists (select 1 from public.sales_locations where name ilike 'bhadrapur%');

  -- ---------------------------------------------------------------- roads (in the package: Rs 0)
  insert into public.sales_transfer_rates (from_location_id, to_location_id, vehicle_type, capacity, rate, drive_hours, night_surcharge, bidirectional, tax_pct, active)
  select a.id, v_loc, '4x4 Bolero (in the Red Panda package)', 3, 0, x.hours, 0, true, 0, true
  from (values ('bagdogra%airport%', 5::numeric), ('bhadrapur%airport%', 3.5), ('mayfair%', 5)) as x(pattern, hours)
  join lateral (
    select l.id from public.sales_locations l
    where l.active is not false and (l.name ilike x.pattern or l.property_id in (select p.id from public.sales_properties p where p.name ilike x.pattern))
    order by l.name limit 1
  ) a on true
  where v_loc is not null
    and not exists (
      select 1 from public.sales_transfer_rates t
      where (t.from_location_id = a.id and t.to_location_id = v_loc) or (t.from_location_id = v_loc and t.to_location_id = a.id)
    );

  -- ---------------------------------------------------------------- day texts, includes, notes
  select string_agg(g, E'\n') into v_gtk from public.rp_settings s, jsonb_array_elements_text(s.data->'good_to_know') g where s.id = 1;

  insert into public.sales_content_blocks (kind, title, body, park_id, property_id, is_default, sort, active)
  select x.kind, x.title, x.body, null, v_prop, false, 0, true
  from (values
    ('day_arrival', 'Arrive and on to Red Panda Outpost',
     'Fly to {from} and drive to Jaubari village, adjoining Singalila National Park in Nepal{hours}. The road crosses the India - Nepal border at Kakarbhitta (immigration at both ends; our local representative assists you), and the last 1 - 1.5 hours has no metalled road: we travel in comfortable 4x4 Boleros. Please land before 10 AM (an early morning flight is suggested). Evening at leisure, a brief orientation, dinner and overnight at {lodge}.'),
    ('day_transfer', 'On to Red Panda Outpost',
     'After breakfast, drive from {from} to Jaubari village, adjoining Singalila National Park in Nepal{hours}, crossing the India - Nepal border (immigration at both ends; our local representative assists you). The last 1 - 1.5 hours has no metalled road: we travel in comfortable 4x4 Boleros. Dinner and overnight at {lodge}.'),
    ('day_leisure', 'In search of the red panda / birding',
     'Our expert tracking team leaves early each morning to look for signs of the red panda in the forests around Singalila National Park in Nepal and India; you may join this morning ritual. After a hearty breakfast, birdwatching in an area home to over 350 species of birds. Once the trackers report fresh signs or a sighting, you go to the area with a naturalist: by 4x4 Bolero to the closest point, then a 15 - 30 minute walk in dense forest. Hikers can trek after breakfast and be driven back. A picnic lunch on site or lunch at the Outpost; evenings by the bukhari fire.'),
    ('day_departure', 'Goodbye to the mountains',
     'After an early breakfast, we say goodbye to the mountains and drive to {to}{hours}, crossing back over the India - Nepal border, for your onward journey. Please book flights after 5 PM.'),
    ('inclusions', 'Red Panda Outpost includes',
     'Red Panda Outpost (Jaubari, Nepal): well-appointed rooms with attached facilities, all meals and tea / coffee' || E'\n' ||
     'Red Panda Expedition with tracker support and a naturalist with extensive knowledge of the local flora, fauna and ecosystem' || E'\n' ||
     'Pick-up and drop between Bagdogra (or Bhadrapur) and Red Panda Outpost in 4x4 Boleros, with assistance at the India - Nepal border' || E'\n' ||
     'Shared porters and 4x4 Boleros for the stay at Red Panda Outpost' || E'\n' ||
     'Wildlife permit cost and conservation fees in Singalila' || E'\n' ||
     'Still camera permits at Singalila, 1 per person' || E'\n' ||
     'Trek or visit to Sandakphu top / sightseeing in neighbouring villages (international guests are currently not permitted to Sandakphu top)'),
    ('exclusions', 'Red Panda Outpost does not include',
     'Meals and beverages en route to and from Red Panda Outpost' || E'\n' ||
     'Visa fee (a Nepal visa for foreign guests, and a multiple-entry Indian visa when arriving and leaving through India)'),
    ('important_notes', 'Red Panda Outpost: good to know', coalesce(v_gtk, ''))
  ) as x(kind, title, body)
  where v_prop is not null
    and not exists (select 1 from public.sales_content_blocks b where b.property_id = v_prop and b.kind = x.kind);

  -- ---------------------------------------------------------------- the reader: "redpanda" in one word
  if to_regclass('public.sales_reader_rules') is not null then
    insert into public.sales_reader_rules (phrase, meaning, kind, source, status)
    select 'redpanda', 'Red Panda Outpost', 'lodge', 'admin', 'approved'
    where not exists (select 1 from public.sales_reader_rules where lower(btrim(phrase)) = 'redpanda');
  end if;
end
$rp$;

notify pgrst, 'reload schema';

-- Check (expected: park 1, lodge 1, room 1, rates 0, place 1, bhadrapur 1, roads 3, texts 7)
select
  (select count(*) from public.sales_parks where name ilike 'singalila%') as park,
  (select count(*) from public.sales_properties where name ilike 'red panda outpost%' and kind = 'own_lodge') as lodge,
  (select count(*) from public.sales_room_categories rc join public.sales_properties p on p.id = rc.property_id where p.name ilike 'red panda outpost%') as room,
  (select count(*) from public.sales_room_rates r join public.sales_room_categories rc on rc.id = r.room_category_id join public.sales_properties p on p.id = rc.property_id where p.name ilike 'red panda outpost%') as rates,
  (select count(*) from public.sales_locations l join public.sales_properties p on p.id = l.property_id where p.name ilike 'red panda outpost%') as place,
  (select count(*) from public.sales_locations where name ilike 'bhadrapur%') as bhadrapur,
  (select count(*) from public.sales_transfer_rates t join public.sales_locations l on l.id in (t.from_location_id, t.to_location_id) join public.sales_properties p on p.id = l.property_id where p.name ilike 'red panda outpost%') as roads,
  (select count(*) from public.sales_content_blocks b join public.sales_properties p on p.id = b.property_id where p.name ilike 'red panda outpost%') as texts;
