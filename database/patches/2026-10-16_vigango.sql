-- PATCH 2026-10-16 (decision R-02): Minga, Mughanga and Mangua are vigango like
-- the other four — no "parokiani / vigangoni" label. Changes no records.
update public.org_units set zone = null where unit_type = 'kigango';
select name as kigango, zone from public.org_units where unit_type = 'kigango' order by ordinal;
