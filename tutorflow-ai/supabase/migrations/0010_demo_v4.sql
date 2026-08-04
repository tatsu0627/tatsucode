create or replace function public.seed_demo_workspace(demo_id uuid)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from profiles p where p.id = demo_id and p.is_demo) then
    raise exception 'seed_demo_workspace requires a demo profile';
  end if;

  if (select count(*) from concepts where code in (
    'integer-signs', 'integer-operations', 'fraction-operations', 'order-of-operations',
    'distributive-property', 'combine-like-terms', 'one-step-equations',
    'multi-step-linear-equations', 'coordinate-plane', 'exponent-rules',
    'polynomial-vocabulary', 'polynomial-operations', 'greatest-common-factor',
    'factoring-gcf', 'factoring-trinomials', 'zero-product-property',
    'square-roots', 'quadratic-equations'
  )) < 18 then
    insert into concepts (id, code, label, description, depth)
    values
      ('50000000-0000-4000-8000-000000000001', 'integer-signs', 'Integer signs', 'Apply positive and negative signs consistently.', 0),
      ('50000000-0000-4000-8000-000000000002', 'integer-operations', 'Integer operations', 'Add, subtract, multiply, and divide integers.', 1),
      ('50000000-0000-4000-8000-000000000003', 'fraction-operations', 'Fraction operations', 'Compute with fractions and simplify results.', 2),
      ('50000000-0000-4000-8000-000000000004', 'order-of-operations', 'Order of operations', 'Evaluate grouped expressions in the correct order.', 2),
      ('50000000-0000-4000-8000-000000000005', 'distributive-property', 'Distributive property', 'Expand a factor across grouped terms.', 3),
      ('50000000-0000-4000-8000-000000000006', 'combine-like-terms', 'Combine like terms', 'Recognize and combine terms with matching variable parts.', 3),
      ('50000000-0000-4000-8000-000000000007', 'one-step-equations', 'One-step equations', 'Undo one operation to isolate a variable.', 3),
      ('50000000-0000-4000-8000-000000000008', 'multi-step-linear-equations', 'Multi-step linear equations', 'Simplify and solve equations requiring several inverse operations.', 4),
      ('50000000-0000-4000-8000-000000000009', 'coordinate-plane', 'Coordinate plane', 'Interpret ordered pairs and graph relationships.', 2),
      ('50000000-0000-4000-8000-000000000010', 'exponent-rules', 'Exponent rules', 'Use products, powers, and zero exponents.', 2),
      ('50000000-0000-4000-8000-000000000011', 'polynomial-vocabulary', 'Polynomial vocabulary', 'Identify coefficients, degrees, and like terms.', 3),
      ('50000000-0000-4000-8000-000000000012', 'polynomial-operations', 'Polynomial operations', 'Add and multiply polynomial expressions.', 4),
      ('50000000-0000-4000-8000-000000000013', 'greatest-common-factor', 'Greatest common factor', 'Find the greatest common numerical and variable factor.', 3),
      ('50000000-0000-4000-8000-000000000014', 'factoring-gcf', 'Factoring a GCF', 'Rewrite a polynomial by extracting its greatest common factor.', 4),
      ('50000000-0000-4000-8000-000000000015', 'factoring-trinomials', 'Factoring trinomials', 'Factor monic and simple non-monic quadratic trinomials.', 5),
      ('50000000-0000-4000-8000-000000000016', 'zero-product-property', 'Zero-product property', 'Use a product equal to zero to solve for possible values.', 4),
      ('50000000-0000-4000-8000-000000000017', 'square-roots', 'Square roots', 'Simplify square roots and solve simple square equations.', 3),
      ('50000000-0000-4000-8000-000000000018', 'quadratic-equations', 'Quadratic equations', 'Choose and apply a method for solving a quadratic equation.', 6)
    on conflict (code) do update set
      label = excluded.label,
      description = excluded.description,
      depth = excluded.depth,
      updated_at = now();

    insert into concept_edges (prerequisite_id, dependent_id)
    select prerequisite.id, dependent.id
    from (values
      ('integer-signs', 'integer-operations'),
      ('integer-operations', 'fraction-operations'),
      ('integer-operations', 'order-of-operations'),
      ('integer-operations', 'distributive-property'),
      ('integer-operations', 'combine-like-terms'),
      ('integer-operations', 'one-step-equations'),
      ('one-step-equations', 'multi-step-linear-equations'),
      ('combine-like-terms', 'multi-step-linear-equations'),
      ('distributive-property', 'multi-step-linear-equations'),
      ('integer-signs', 'coordinate-plane'),
      ('integer-operations', 'exponent-rules'),
      ('exponent-rules', 'polynomial-vocabulary'),
      ('combine-like-terms', 'polynomial-vocabulary'),
      ('polynomial-vocabulary', 'polynomial-operations'),
      ('distributive-property', 'polynomial-operations'),
      ('integer-operations', 'greatest-common-factor'),
      ('greatest-common-factor', 'factoring-gcf'),
      ('polynomial-vocabulary', 'factoring-gcf'),
      ('factoring-gcf', 'factoring-trinomials'),
      ('polynomial-operations', 'factoring-trinomials'),
      ('integer-signs', 'factoring-trinomials'),
      ('one-step-equations', 'zero-product-property'),
      ('exponent-rules', 'square-roots'),
      ('fraction-operations', 'square-roots'),
      ('factoring-trinomials', 'quadratic-equations'),
      ('zero-product-property', 'quadratic-equations'),
      ('square-roots', 'quadratic-equations'),
      ('multi-step-linear-equations', 'quadratic-equations')
    ) as edge(prerequisite_code, dependent_code)
    join concepts prerequisite on prerequisite.code = edge.prerequisite_code
    join concepts dependent on dependent.code = edge.dependent_code
    on conflict do nothing;
  end if;

  delete from probes where consultation_id in (
    select c.id from consultations c join students s on s.id = c.student_id where s.owner_id = demo_id
  );
  delete from generation_runs where owner_id = demo_id;
  delete from materials where student_id in (select id from students where owner_id = demo_id);
  delete from consultations where student_id in (select id from students where owner_id = demo_id);
  delete from students where owner_id = demo_id;

  insert into students (id, owner_id, alias, current_level, learning_goal)
  select seed.id, demo.id, seed.alias, seed.current_level, seed.learning_goal
  from (select demo_id as id) demo
  cross join (values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'Demo Student A (Algebra)', 'Intermediate algebra', 'Identify the prerequisite blocking quadratic equations'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'Demo Student B (Drop-in)', 'Beginning algebra', 'Build fluency with signed numbers and equations'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'Demo Student C (Review)', 'College algebra', 'Review polynomial operations before the next course')
  ) as seed(id, alias, current_level, learning_goal)
  on conflict (id) do update set
    owner_id = excluded.owner_id,
    alias = excluded.alias,
    current_level = excluded.current_level,
    learning_goal = excluded.learning_goal,
    active = true,
    updated_at = now();

  insert into consultations (
    id, student_id, target_concept_id, root_blocker_concept_id,
    consultation_date, topic, summary, private_notes, completed_at, created_at, updated_at
  )
  values
    (
      '60000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000018',
      null,
      current_date,
      'Quadratic equation diagnosis',
      'Student requested help with quadratic equations. Diagnosis is in progress.',
      'Fictional demo consultation.',
      null,
      now() - interval '2 days',
      now() - interval '2 days'
    ),
    (
      '60000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000008',
      '50000000-0000-4000-8000-000000000002',
      current_date - 6,
      'Linear equation diagnosis',
      'The root blocker was integer operations.',
      null,
      now() - interval '6 days',
      now() - interval '6 days',
      now() - interval '6 days'
    ),
    (
      '60000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000015',
      '50000000-0000-4000-8000-000000000005',
      current_date - 12,
      'Factoring readiness',
      'The distributive property needed reinforcement before factoring.',
      null,
      now() - interval '12 days',
      now() - interval '12 days',
      now() - interval '12 days'
    );

  insert into materials (
    id, student_id, concept_id, kind, topic, difficulty, state,
    ai_draft, verified_content, discard_reason, prompt_version,
    model_label, verified_at, created_at, updated_at
  )
  values
    (
      '70000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'probe', 'Integer operations check', 'introductory', 'verified',
      '{"concept_code":"integer-operations","topic":"Integer operations","difficulty":"introductory","learning_objective":"Check integer operations before moving to equations","problems":[{"question":"Evaluate -7 + 12 - 3.","hints":["Combine -7 and 12 first."],"solution_steps":["-7 + 12 = 5.","5 - 3 = 2."],"common_mistakes":["Treating -7 as positive 7."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      '{"concept_code":"integer-operations","topic":"Integer operations","difficulty":"introductory","learning_objective":"Check integer operations before moving to equations","problems":[{"question":"Evaluate -7 + 12 - 3.","hints":["Combine -7 and 12 first."],"solution_steps":["-7 + 12 = 5.","5 - 3 = 2."],"common_mistakes":["Treating -7 as positive 7."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      null, 'probe-v1', 'gpt-5.6-luna', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'
    ),
    (
      '70000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      'probe', 'Distributive property check', 'standard', 'verified',
      '{"concept_code":"distributive-property","topic":"Distributive property","difficulty":"standard","learning_objective":"Check expansion of signed grouped terms","problems":[{"question":"Expand and simplify -3(2x - 5).","hints":["Multiply -3 by each term inside the parentheses."],"solution_steps":["-3 times 2x is -6x.","-3 times -5 is +15.","The result is -6x + 15."],"common_mistakes":["Changing the sign of only the first term."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      '{"concept_code":"distributive-property","topic":"Distributive property","difficulty":"standard","learning_objective":"Check expansion of signed grouped terms","problems":[{"question":"Expand and simplify -3(2x - 5).","hints":["Multiply -3 by each term inside the parentheses."],"solution_steps":["-3 times 2x is -6x.","-3 times -5 is +15.","The result is -6x + 15."],"common_mistakes":["Changing the sign of only the first term."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      null, 'probe-v1', 'gpt-5.6-luna', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days'
    ),
    (
      '70000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000002',
      'probe', 'Integer operations check', 'introductory', 'verified',
      '{"concept_code":"integer-operations","topic":"Integer operations","difficulty":"introductory","learning_objective":"Check operations with signed integers","problems":[{"question":"Evaluate -4 times 6 + 5.","hints":["Perform multiplication before addition."],"solution_steps":["-4 times 6 is -24.","-24 + 5 is -19."],"common_mistakes":["Adding before multiplying."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      '{"concept_code":"integer-operations","topic":"Integer operations","difficulty":"introductory","learning_objective":"Check operations with signed integers","problems":[{"question":"Evaluate -4 times 6 + 5.","hints":["Perform multiplication before addition."],"solution_steps":["-4 times 6 is -24.","-24 + 5 is -19."],"common_mistakes":["Adding before multiplying."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      null, 'probe-v1', 'gpt-5.6-luna', now() - interval '8 days', now() - interval '8 days', now() - interval '8 days'
    ),
    (
      '70000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000005',
      'probe', 'Distributive property check', 'introductory', 'verified',
      '{"concept_code":"distributive-property","topic":"Distributive property","difficulty":"introductory","learning_objective":"Check basic distribution","problems":[{"question":"Expand 4(x + 3).","hints":["Multiply 4 by both terms."],"solution_steps":["4 times x is 4x.","4 times 3 is 12.","The result is 4x + 12."],"common_mistakes":["Multiplying only x by 4."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      '{"concept_code":"distributive-property","topic":"Distributive property","difficulty":"introductory","learning_objective":"Check basic distribution","problems":[{"question":"Expand 4(x + 3).","hints":["Multiply 4 by both terms."],"solution_steps":["4 times x is 4x.","4 times 3 is 12.","The result is 4x + 12."],"common_mistakes":["Multiplying only x by 4."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      null, 'probe-v1', 'gpt-5.6-luna', now() - interval '13 days', now() - interval '13 days', now() - interval '13 days'
    ),
    (
      '70000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000018',
      'practice', 'Quadratic equations practice', 'standard', 'unverified',
      '{"topic":"Quadratic equations","difficulty":"standard","learning_objective":"Choose a suitable solution method","problems":[{"question":"Solve x^2 - 5x + 6 = 0.","hints":["Find two numbers whose product is 6."],"solution_steps":["Factor as (x-2)(x-3)=0.","Use the zero-product property."],"common_mistakes":["Reporting only one root."]}],"review_warning":"AI-generated draft. Verify all mathematics before use."}'::jsonb,
      null, null, 'v1', 'gpt-5.6-luna', null, now() - interval '1 day', now() - interval '1 day'
    );

  insert into probes (
    id, consultation_id, concept_id, material_id, material_state, result, step, created_at
  )
  values
    (
      '80000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000001',
      'verified', 'solved', 1, now() - interval '2 days'
    ),
    (
      '80000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000002',
      '70000000-0000-4000-8000-000000000003',
      'verified', 'failed', 1, now() - interval '6 days'
    ),
    (
      '80000000-0000-4000-8000-000000000003',
      '60000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000005',
      '70000000-0000-4000-8000-000000000004',
      'verified', 'failed', 1, now() - interval '12 days'
    );

  insert into generation_runs (
    id, material_id, owner_id, model_label, prompt_version,
    latency_ms, success, validation_error, created_at
  )
  select run.id, run.material_id, demo.id, 'gpt-5.6-luna', run.prompt_version,
    run.latency_ms, run.success, run.validation_error, run.created_at
  from (select demo_id as id) demo
  cross join (values
    ('40000000-0000-4000-8000-000000000001'::uuid, '70000000-0000-4000-8000-000000000001'::uuid, 'probe-v1', 8200, true, null::text, now() - interval '8 days'),
    ('40000000-0000-4000-8000-000000000002'::uuid, '70000000-0000-4000-8000-000000000002'::uuid, 'probe-v1', 7600, true, null::text, now() - interval '6 days'),
    ('40000000-0000-4000-8000-000000000003'::uuid, '70000000-0000-4000-8000-000000000003'::uuid, 'probe-v1', 9100, true, null::text, now() - interval '5 days'),
    ('40000000-0000-4000-8000-000000000004'::uuid, '70000000-0000-4000-8000-000000000004'::uuid, 'probe-v1', 6800, true, null::text, now() - interval '3 days'),
    ('40000000-0000-4000-8000-000000000005'::uuid, null::uuid, 'probe-v1', 10100, false, 'concept code mismatch', now() - interval '1 day')
  ) as run(id, material_id, prompt_version, latency_ms, success, validation_error, created_at);
end;
$$;

select public.seed_demo_workspace(id) from profiles where is_demo order by created_at limit 1;
