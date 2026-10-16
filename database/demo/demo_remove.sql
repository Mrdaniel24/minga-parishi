-- ============================================================================
-- Minga Parish Management System — remove the DEMO login accounts
--   Run before the system is handed to the parish (Supabase → SQL Editor → Run).
--   Deletes only the *@minga.demo accounts and their roles; parish records stay.
-- ============================================================================
update public.parishioners set profile_id = null
 where profile_id in (select id from auth.users where email like '%@minga.demo');
delete from auth.users where email like '%@minga.demo';   -- profiles and parish roles go with them
drop function if exists public.demo_link_member();
select count(*) as akaunti_za_demo_zilizobaki from auth.users where email like '%@minga.demo';
