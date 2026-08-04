create type difficulty_level as enum ('introductory', 'standard', 'advanced');
create type material_state as enum ('unverified', 'verified', 'discarded');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 50),
  current_level text check (char_length(current_level) <= 100),
  learning_goal text check (char_length(learning_goal) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index students_owner_idx on students (owner_id) where active;

create table sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  session_date date not null,
  topic text not null check (char_length(topic) between 1 and 100),
  understanding smallint not null check (understanding between 1 and 5),
  summary text not null check (char_length(summary) between 1 and 2000),
  difficulty_notes text check (char_length(difficulty_notes) <= 2000),
  next_goal text check (char_length(next_goal) <= 500),
  private_notes text check (char_length(private_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_student_date_idx on sessions (student_id, session_date desc);

create table materials (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  topic text not null check (char_length(topic) between 1 and 100),
  difficulty difficulty_level not null,
  state material_state not null default 'unverified',
  ai_draft jsonb not null,
  verified_content jsonb,
  discard_reason text check (char_length(discard_reason) <= 500),
  prompt_version text not null,
  model_label text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint materials_verified_consistency check (
    state <> 'verified'
    or (verified_content is not null and verified_at is not null)
  ),
  constraint materials_discarded_consistency check (
    state = 'discarded' or discard_reason is null
  ),
  constraint materials_session_requires_verified check (
    session_id is null or state = 'verified'
  )
);
create index materials_student_state_idx on materials (student_id, state);
create index materials_state_created_idx on materials (state, created_at desc);
create index materials_topic_idx on materials (student_id, topic);

create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references materials(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  model_label text not null,
  prompt_version text not null,
  latency_ms integer not null check (latency_ms >= 0),
  success boolean not null,
  validation_error text check (char_length(validation_error) <= 1000),
  created_at timestamptz not null default now()
);
create index generation_runs_owner_created_idx on generation_runs (owner_id, created_at desc);
