do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.seed_demo_workspace(uuid)'::regprocedure);
  if position('claude-opus-5' in function_definition) > 0 then
    execute replace(function_definition, 'claude-opus-5', 'gpt-5.6-luna');
  end if;
end;
$$;

update materials as material
set model_label = 'gpt-5.6-luna'
from students as student, profiles as profile
where material.student_id = student.id
  and student.owner_id = profile.id
  and profile.is_demo
  and material.model_label = 'claude-opus-5';

update generation_runs as run
set model_label = 'gpt-5.6-luna'
from profiles as profile
where run.owner_id = profile.id
  and profile.is_demo
  and run.model_label = 'claude-opus-5';
