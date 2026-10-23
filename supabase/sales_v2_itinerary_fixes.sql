-- =====================================================================
-- Sales: itinerary builder fixes (October 2026)
-- Run once in Supabase > SQL Editor, BEFORE deploying the new code
-- (the Add-ons form saves the new columns). Safe to run again.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Add-on rules: minimum guests, guests included + each extra guest,
--    days it is not available
-- ---------------------------------------------------------------------
alter table public.sales_addons
  add column if not exists min_guests int check (min_guests is null or min_guests between 1 and 50),
  add column if not exists included_guests int check (included_guests is null or included_guests between 1 and 50),
  add column if not exists extra_guest_rate numeric(12,2) check (extra_guest_rate is null or extra_guest_rate >= 0),
  add column if not exists unavailable_weekdays int[] not null default '{}',
  add column if not exists availability_note text;

-- Walking safari in the buffer zone, Satpura (Denwa Backwater Escape): Rs 3,000 per person, min 2 guests
update public.sales_addons
   set min_guests = 2, description = 'Guided walk in the buffer zone (minimum 2 guests)'
 where id = '8bdbad2c-0cf9-4ce7-9638-a05b3828c8fe';

-- Private (bush) dinner, Kanha Earth Lodge: Rs 4,000 per person + 18% GST, min 2 guests
update public.sales_addons
   set min_guests = 2, description = 'Private dinner experience (minimum 2 guests)'
 where id = '5113a10b-d16a-49ed-8217-05f6ee1e9525';

-- Boat cruise on the Tawa Dam, Satpura (Denwa Backwater Escape):
-- Rs 18,000 for 2 guests (2 to 2.5 hours), each further guest (children 5 and over) Rs 1,500.
-- Closed on Wednesday evenings. GST: none added (check, and set tax % in Master data if it applies).
insert into public.sales_addons (name, description, property_id, park_id, pricing_unit, rate, tax_pct, active,
                                 included_guests, extra_guest_rate, unavailable_weekdays, availability_note)
select 'Boat cruise (Tawa Dam), 2 to 2.5 hours',
       'For 2 guests; each additional guest (including children above 5 years) Rs 1,500',
       'fbbffcaa-6c02-4a78-b090-84aab10111e6', null, 'per_group', 18000, 0, true,
       2, 1500, '{3}', 'Closed on Wednesday evenings'
 where not exists (select 1 from public.sales_addons where name = 'Boat cruise (Tawa Dam), 2 to 2.5 hours');

-- ---------------------------------------------------------------------
-- 2. Price includes / does not include: now written by the app from each
--    itinerary (meal plans, naturalist and flights only when added, taxes).
--    The old fixed lists are switched off so lines are not repeated.
--    Any block of kind inclusions / exclusions added later is shown as
--    extra lines under the generated ones.
-- ---------------------------------------------------------------------
update public.sales_content_blocks set active = false
 where id in ('efc002b6-13e8-4637-abb8-f9d78e7654f3',   -- Inclusions
              '2151fd46-4f28-4e1b-8f9b-71a369bf0e6f');  -- Exclusions

-- ---------------------------------------------------------------------
-- 3. Good to know: park closures are now written by the app from
--    Master data > Park closures, naming only the parks in the itinerary
--    (and festivals / monsoon only when they fall in the trip). The
--    closure sentences are removed from the park notes to avoid repeats.
-- ---------------------------------------------------------------------
-- Bandhavgarh, Kanha, Pench: the note was only the closure sentence
update public.sales_content_blocks set active = false
 where id in ('a7d8d7e6-4162-4c3f-a1e7-2532cba92ecb',   -- Bandhavgarh
              '61d3bb9c-2a4b-4a63-b45b-f3eb0ac5a8c9',   -- Kanha
              '1471a932-ecaa-48b6-a194-078f7791af80');  -- Pench

-- Satpura: keep the naturalist line only
update public.sales_content_blocks
   set body = 'Satpura jeeps are not naturalist driven; a naturalist needs a seat in the jeep.'
 where id = '622610af-d6e5-46f2-aacb-95e5d11f2099';

-- Tadoba: the buffer-zone advice instead of the closure sentence
update public.sales_content_blocks
   set body = 'Buffer zones in Tadoba are equally productive as core zones and we recommend a mix of core and buffer safaris even when the core is open, to maximise sighting chances.
Tadoba jeeps are not naturalist driven. A naturalist can be booked at Rs 2,500 per safari and needs a seat in the jeep.
Jeeps must enter the park within 15 minutes of the gate opening; a Rs 500 penalty applies for 15-30 minutes'' delay, after which entry is refused.'
 where id = '873b05b5-888b-4f1c-b17a-0873970a4fc8';

-- General notes: mobile phones line
update public.sales_content_blocks
   set body = replace(body, 'Mobile phones are not allowed inside the parks.', 'Mobile phones are strictly not allowed in all the national parks.')
 where id = '2911d1f2-4c0c-4d5e-a742-976fb222bfcf';

-- ---------------------------------------------------------------------
-- 4. Free reschedule: keep the flexibility with us, as per the new dates
-- ---------------------------------------------------------------------
update public.sales_content_blocks
   set body = '50% of the total is due at booking and the balance 45 days before arrival. For bookings made within 45 days of arrival, full payment is due at booking.
If you cannot travel because of conditions beyond your control, we will do our best to reschedule your trip to new dates, subject to availability and the rates applicable for the new travel dates; forest permits already issued are charged. This applies to fully paid bookings affected by force majeure.'
 where id = 'cd473b53-83d2-44a0-9b98-fd3369a707a8';

commit;

-- ---------------------------------------------------------------------
-- Still to add from Master data (prices were not in the task list):
--  * Safari rates > Tadoba, session "Full day", zone Core and zone Buffer
--    (until then the builder asks for the price on Plan & price).
--  * Add-ons > "Jeep with naturalist (without safari permit)" for each MP
--    lodge (Kings Lodge, Tree House Hideaway, Kanha Earth Lodge, Pench Tree
--    Lodge, Denwa Backwater Escape), Priced: Per vehicle.
--  * Transfers: approximate drive hours on the roads that have none yet.
--  * Parks: long description and wildlife photos (shown under About the parks).
--  * Sales settings: the 2027-28 yearly hike (season name, dates, % for
--    hotels / safaris / transfers).
-- ---------------------------------------------------------------------
