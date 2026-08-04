create type material_kind as enum ('practice', 'probe');
create type probe_result as enum ('solved', 'failed', 'skipped');

create table concepts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (char_length(code) between 1 and 80),
  label       text not null check (char_length(label) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  depth       smallint not null check (depth between 0 and 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index concepts_depth_code_idx on concepts (depth, code);

create table concept_edges (
  prerequisite_id uuid not null references concepts(id) on delete cascade,
  dependent_id    uuid not null references concepts(id) on delete cascade,
  created_at      timestamptz not null default now(),

  constraint concept_edges_no_self_reference check (prerequisite_id <> dependent_id),
  primary key (prerequisite_id, dependent_id)
);
create index concept_edges_dependent_idx on concept_edges (dependent_id, prerequisite_id);

create table consultations (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null references students(id) on delete cascade,
  target_concept_id       uuid references concepts(id) on delete restrict,
  root_blocker_concept_id uuid references concepts(id) on delete set null,
  consultation_date       date not null default current_date,
  topic                   text not null check (char_length(topic) between 1 and 120),
  summary                 text not null default '' check (char_length(summary) <= 2000),
  private_notes           text check (char_length(private_notes) <= 2000),
  completed_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint consultations_completion_consistency check (
    completed_at is null or root_blocker_concept_id is not null or target_concept_id is null
  )
);
create index consultations_student_date_idx on consultations (student_id, consultation_date desc);
create index consultations_active_idx on consultations (student_id, created_at desc) where completed_at is null;
