alter table concepts enable row level security;
alter table concept_edges enable row level security;
alter table consultations enable row level security;
alter table probes enable row level security;

create policy concepts_authenticated_select on concepts
  for select to authenticated using (true);

create policy concept_edges_authenticated_select on concept_edges
  for select to authenticated using (true);

create policy consultations_owner_all on consultations
  for all using (
    exists (
      select 1 from students s
      where s.id = consultations.student_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from students s
      where s.id = consultations.student_id and s.owner_id = auth.uid()
    )
  );

create policy probes_owner_all on probes
  for all using (
    exists (
      select 1
      from consultations c
      join students s on s.id = c.student_id
      where c.id = probes.consultation_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from consultations c
      join students s on s.id = c.student_id
      where c.id = probes.consultation_id and s.owner_id = auth.uid()
    )
  );
