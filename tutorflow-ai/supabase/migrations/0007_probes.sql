alter table materials add column concept_id uuid references concepts(id) on delete set null;
alter table materials add column kind material_kind not null default 'practice';
create index materials_concept_kind_idx on materials (concept_id, kind, state);

-- 複合外部キーの参照先として (id, state) に一意制約を張る
alter table materials add constraint materials_id_state_key unique (id, state);

create table probes (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references consultations(id) on delete cascade,
  concept_id      uuid not null references concepts(id) on delete cascade,
  material_id     uuid not null,
  material_state  material_state not null default 'verified',
  result          probe_result not null,
  step            smallint not null check (step between 1 and 20),
  created_at      timestamptz not null default now(),

  constraint probes_material_must_be_verified check (material_state = 'verified'),
  constraint probes_material_fk foreign key (material_id, material_state)
    references materials (id, state) on update cascade,

  unique (consultation_id, step)
);
create index probes_consultation_created_idx on probes (consultation_id, created_at);
create index probes_concept_result_idx on probes (concept_id, result);
