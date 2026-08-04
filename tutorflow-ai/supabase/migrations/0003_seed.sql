-- All demo data below is fictional. Created for portfolio demonstration only.
-- No real student information is used.

do $$
begin
  if not exists (select 1 from auth.users where lower(email) = lower('demo@tutorflow.local')) then
    raise exception 'Demo auth user demo@tutorflow.local was not found. Create it in Supabase Auth first, or edit this file if DEMO_EMAIL differs.';
  end if;
end $$;

insert into profiles (id, display_name, is_demo)
select id, 'TutorFlow Demo', true
from auth.users
where lower(email) = lower('demo@tutorflow.local')
on conflict (id) do update set display_name = excluded.display_name, is_demo = true;

do $$
declare
  demo_id uuid;
begin
  select id into demo_id from profiles where is_demo order by created_at limit 1;
  if to_regprocedure('public.seed_demo_workspace(uuid)') is not null then
    perform public.seed_demo_workspace(demo_id);
  end if;
end $$;
