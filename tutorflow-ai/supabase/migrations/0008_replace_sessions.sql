insert into consultations (
  id, student_id, consultation_date, topic, summary, private_notes,
  completed_at, created_at, updated_at
)
select
  id,
  student_id,
  session_date,
  topic,
  concat_ws(
    E'\n\n',
    summary,
    case when difficulty_notes is not null then 'Difficulty notes: ' || difficulty_notes end,
    case when next_goal is not null then 'Next goal: ' || next_goal end,
    'Legacy understanding: ' || understanding::text || '/5'
  ),
  private_notes,
  greatest(created_at, session_date::timestamptz),
  created_at,
  updated_at
from sessions
on conflict (id) do nothing;

alter table materials drop constraint materials_session_requires_verified;
alter table materials drop column session_id;
drop table sessions;
