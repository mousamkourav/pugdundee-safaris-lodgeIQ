-- =====================================================================
-- Removes the line "Tea and coffee service" from the inclusions (and any other
-- text block) in Master data > Content, so it no longer shows on itineraries.
-- Only that line is removed; the rest of each block stays as it is.
-- Safe to run more than once.
-- =====================================================================

update sales_content_blocks
set body = btrim(regexp_replace(body, '^[ \t]*[-*\u2022]?[ \t]*tea (and|&) coffee service[^\n]*(\r?\n|$)', '', 'gin'), E' \r\n')
where body ~* 'tea (and|&) coffee service';

-- check: 0 blocks still mention it
select count(*) as blocks_still_mentioning_tea_and_coffee
from sales_content_blocks
where body ~* 'tea (and|&) coffee service';
