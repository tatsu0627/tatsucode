alter table profiles enable row level security;
alter table students enable row level security;
alter table sessions enable row level security;
alter table materials enable row level security;
alter table generation_runs enable row level security;

create policy profiles_self_select on profiles
  for select using (id = auth.uid());

create policy students_owner_all on students
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy sessions_owner_all on sessions
  for all using (
    exists (
      select 1 from students s
      where s.id = sessions.student_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from students s
      where s.id = sessions.student_id and s.owner_id = auth.uid()
    )
  );

create policy materials_owner_all on materials
  for all using (
    exists (
      select 1 from students s
      where s.id = materials.student_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from students s
      where s.id = materials.student_id and s.owner_id = auth.uid()
    )
  );

create policy runs_owner_all on generation_runs
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
