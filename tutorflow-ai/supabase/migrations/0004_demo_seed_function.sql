create or replace function public.seed_demo_workspace(demo_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from profiles p where p.id = demo_id and p.is_demo) then
    raise exception 'seed_demo_workspace requires a demo profile';
  end if;

  delete from generation_runs where owner_id = demo_id;
  delete from materials where student_id in (select id from students where owner_id = demo_id);
  delete from sessions where student_id in (select id from students where owner_id = demo_id);
  delete from students where owner_id = demo_id;

insert into students (id, owner_id, alias, current_level, learning_goal)
select seed.id, demo.id, seed.alias, seed.current_level, seed.learning_goal
from (select demo_id as id) demo
cross join (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'Demo Student A (Algebra)', 'Intermediate algebra', 'Build confidence solving quadratic equations'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'Demo Student B (Calculus)', 'Calculus I', 'Connect derivatives to graph behavior'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'Demo Student C (Statistics)', 'Introductory statistics', 'Interpret probability distributions')
) as seed(id, alias, current_level, learning_goal)
on conflict (id) do update set alias = excluded.alias, current_level = excluded.current_level,
  learning_goal = excluded.learning_goal, active = true, updated_at = now();

insert into sessions (id, student_id, session_date, topic, understanding, summary, difficulty_notes, next_goal)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', current_date - 28, 'Factoring', 2, 'Practiced identifying factor pairs.', 'Sign errors appeared when the constant was negative.', 'Factor monic quadratics with negative constants.'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', current_date - 21, 'Quadratic equations', 3, 'Connected factoring to the zero-product property.', 'Needed a prompt to set each factor equal to zero.', 'Solve quadratics by factoring independently.'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', current_date - 14, 'Completing the square', 3, 'Rewrote two expressions in vertex form.', 'The balancing step was occasionally omitted.', 'Compare factoring and completing the square.'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', current_date - 7, 'Quadratic methods', 4, 'Selected an efficient solution method for mixed examples.', null, 'Practice applications that produce quadratic equations.'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', current_date - 12, 'Derivative rules', 3, 'Applied power and sum rules to polynomials.', 'Notation for evaluated derivatives needs reinforcement.', 'Use derivatives to find critical points.'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000002', current_date - 5, 'Critical points', 4, 'Found critical points and tested intervals.', 'Endpoints were initially omitted.', 'Interpret increasing and decreasing intervals from f prime.')
on conflict (id) do update set summary = excluded.summary, next_goal = excluded.next_goal, updated_at = now();

insert into materials (
  id, student_id, session_id, topic, difficulty, state, ai_draft, verified_content,
  discard_reason, prompt_version, model_label, verified_at
)
values
  (
    '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000004', 'Quadratic equations', 'standard', 'verified',
    '{"topic":"Quadratic equations","difficulty":"standard","learning_objective":"Choose a suitable solution method","problems":[{"question":"Solve x^2 - 5x + 6 = 0.","hints":["Find two numbers whose product is 6.","Use the zero-product property."],"solution_steps":["Factor as (x-2)(x-3)=0.","Therefore x=2 or x=3."],"common_mistakes":["Reporting only one root."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    '{"topic":"Quadratic equations","difficulty":"standard","learning_objective":"Choose a suitable solution method","problems":[{"question":"Solve x^2 - 5x + 6 = 0 and verify both roots.","hints":["Find two numbers whose product is 6.","Use the zero-product property."],"solution_steps":["Factor as (x-2)(x-3)=0.","Therefore x=2 or x=3.","Substitute both values into the original equation."],"common_mistakes":["Reporting only one root."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    null, 'v1', 'claude-opus-5', now() - interval '7 days'
  ),
  (
    '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
    null, 'Derivative interpretation', 'standard', 'verified',
    '{"topic":"Derivative interpretation","difficulty":"standard","learning_objective":"Interpret the sign of a derivative","problems":[{"question":"Given f prime is positive on (0,2), describe f on that interval.","hints":["Recall what a positive slope means."],"solution_steps":["A positive derivative means f is increasing on (0,2)."],"common_mistakes":["Confusing the value of f with the sign of f prime."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    '{"topic":"Derivative interpretation","difficulty":"standard","learning_objective":"Interpret the sign of a derivative","problems":[{"question":"Given f prime is positive on (0,2), describe f on that interval.","hints":["Recall what a positive slope means."],"solution_steps":["A positive derivative means f is increasing on (0,2)."],"common_mistakes":["Confusing the value of f with the sign of f prime."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    null, 'v1', 'claude-opus-5', now() - interval '4 days'
  ),
  (
    '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
    null, 'Quadratic applications', 'advanced', 'unverified',
    '{"topic":"Quadratic applications","difficulty":"advanced","learning_objective":"Model an area constraint","problems":[{"question":"A rectangle has perimeter 24 and area 32. Find its side lengths.","hints":["Write one side in terms of the other."],"solution_steps":["Let the sides be x and 12-x.","Solve x(12-x)=32."],"common_mistakes":["Using 24-x for the second side."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    null, null, 'v1', 'claude-opus-5', null
  ),
  (
    '30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003',
    null, 'Probability distributions', 'introductory', 'unverified',
    '{"topic":"Probability distributions","difficulty":"introductory","learning_objective":"Check whether probabilities form a distribution","problems":[{"question":"Do probabilities 0.2, 0.3, and 0.5 form a valid distribution?","hints":["Add all probabilities."],"solution_steps":["The values are nonnegative and sum to 1, so the distribution is valid."],"common_mistakes":["Checking the sum but not nonnegativity."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    null, null, 'v1', 'claude-opus-5', null
  ),
  (
    '30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002',
    null, 'Limits', 'standard', 'discarded',
    '{"topic":"Limits","difficulty":"standard","learning_objective":"Evaluate a rational limit","problems":[{"question":"Evaluate lim x to 2 of (x^2-4)/(x-2).","hints":["Factor the numerator."],"solution_steps":["Cancel x-2 and evaluate x+2 at x=2."],"common_mistakes":[]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
    null, 'The topic did not match the next learning goal.', 'v1', 'claude-opus-5', null
  )
on conflict (id) do update set state = excluded.state, ai_draft = excluded.ai_draft,
  verified_content = excluded.verified_content, discard_reason = excluded.discard_reason,
  session_id = excluded.session_id, verified_at = excluded.verified_at, updated_at = now();

insert into generation_runs (id, material_id, owner_id, model_label, prompt_version, latency_ms, success, validation_error, created_at)
select run.id, run.material_id, demo.id, 'claude-opus-5', 'v1', run.latency_ms, run.success, run.validation_error, run.created_at
from (select demo_id as id) demo
cross join (values
  ('40000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, 8200, true, null::text, now() - interval '8 days'),
  ('40000000-0000-4000-8000-000000000002'::uuid, '30000000-0000-4000-8000-000000000002'::uuid, 7600, true, null::text, now() - interval '5 days'),
  ('40000000-0000-4000-8000-000000000003'::uuid, '30000000-0000-4000-8000-000000000003'::uuid, 9100, true, null::text, now() - interval '3 days'),
  ('40000000-0000-4000-8000-000000000004'::uuid, '30000000-0000-4000-8000-000000000004'::uuid, 6800, true, null::text, now() - interval '2 days'),
  ('40000000-0000-4000-8000-000000000005'::uuid, null::uuid, 10100, false, 'problem count mismatch: requested 3, got 2', now() - interval '1 day')
) as run(id, material_id, latency_ms, success, validation_error, created_at)
on conflict (id) do update set success = excluded.success, validation_error = excluded.validation_error;

end;
$$;

select public.seed_demo_workspace(id) from profiles where is_demo order by created_at limit 1;
