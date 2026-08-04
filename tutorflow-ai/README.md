# TutorFlow AI

> This is a personal tool and portfolio project, not an official DVC product.
> All public demo data is fictional.
> Real usage stores aliases rather than student names or institutional records.
> AI-generated probes are drafts and never enter the student-facing diagnosis flow before tutor verification.

TutorFlow AI is a private drop-in diagnostic tool for a mathematics tutor. It traces prerequisite concepts, presents short verified probes, records each result, and identifies the deepest root blocker supported by the evidence.

## Demo

The demo account contains fictional students, an 18-concept algebra graph, consultation history, verified probes, and old generation timestamps. Resetting the demo does not consume the current one-hour generation allowance.

## Background

In drop-in tutoring, a learner may ask about quadratic equations while the actual blocker is two or more prerequisite levels lower. TutorFlow turns that observation into a reproducible workflow rather than relying on an unstructured conversation.

## Problem

A high-level topic label does not identify the first missing prerequisite. AI can draft a useful check, but an unchecked AI question must not be shown to a student.

## Solution

1. Select the student and the concept they brought to the consultation.
2. Traverse the prerequisite graph and choose a probe near the median unknown depth.
3. Use only a tutor-verified probe in the student display.
4. Save `solved`, `failed`, or `skipped` after every probe.
5. Propagate known results through the graph and identify the deepest supported root blocker.

The consultation and every probe result are stored immediately, so an interrupted diagnosis can be resumed.

## Core Constraint

The `probes` table stores both `material_id` and `material_state`. A CHECK requires `material_state = 'verified'`, and a composite foreign key references `materials(id, state)` with `ON UPDATE CASCADE`. Consequently:

- unverified or discarded material cannot be referenced by a probe;
- changing a referenced material away from `verified` is rejected by the database;
- UI or application mistakes cannot bypass the verification gate.

## Key Features

- Owner-scoped student, consultation, material, and probe records
- Shared read-only 18-node prerequisite graph
- Pure deterministic diagnosis engine with transitive propagation
- Resumable `/diagnose` workflow
- Verified-only student display
- OpenAI GPT-5.6 Luna structured probe drafts
- Existing seven-item tutor review workflow
- Warning after more than five probes without convergence
- Fictional resettable demo workspace

## Architecture

See `docs/architecture.md`.

## Tech Stack

Next.js 15 App Router, TypeScript 5, Tailwind CSS 4, Supabase/PostgreSQL, Zod 4, OpenAI SDK, Vitest 3, and Playwright.

## Data Model

See `docs/data-model.md`.

## Security and Privacy

Row Level Security isolates each tutor account. The public concept taxonomy is readable only by authenticated users; it is not editable through the application. The probe prompt builder accepts only a concept code and English label. It cannot accept aliases, notes, or consultation history.

## AI Evaluation

The unchanged evaluation template is in `docs/ai-evaluation.md`. No real model quality score is reported because a live API evaluation was not run.

## Local Setup

1. Use Node.js 22.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and fill the required values.
4. Create the fictional demo Auth user if the demo is required.
5. Apply `supabase/migrations` in numeric order through `0010_demo_v4.sql`.
6. Run `npm run dev`.

Set `MOCK_AI=1` outside production to use deterministic local fixtures. Production ignores the mock flag.

## Testing

The following checks were executed locally and passed:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`: 43/43 passed
- `npm run test:integration`: 15 tests collected, all skipped by the environment guard, exit 0
- `npm run build`

Implemented but not executed against external infrastructure:

- 15 Integration cases against a dedicated Supabase test project
- `tests/e2e/diagnose.spec.ts` and the existing protected material-run E2E flow
- migrations `0006` through `0010` against a hosted Supabase project
- live GPT-5.6 Luna probe generation and quality evaluation

## What I Learned

The important safety property belongs at the database boundary. The redundant `material_state` column is intentional: together with the CHECK and composite foreign key, it turns tutor verification into a referential-integrity rule.

The diagnosis engine is separate from React and Supabase. Pure graph functions make propagation, median selection, and blocker identification deterministic and independently testable.

## Known Limitations

- The bundled graph currently covers 18 algebra prerequisite concepts.
- Concept editing is intentionally read-only in this version.
- A Supabase project and OpenAI API key are still human-provided deployment inputs.
- AI output does not independently establish mathematical correctness; tutor review remains mandatory.

## Future Improvements

Expand the graph to additional mathematics domains, measure real probe convergence, and add graph-authoring tools without weakening the verified-material gate.

## Disclaimer

TutorFlow AI does not replace a teacher and is not affiliated with or endorsed by Diablo Valley College. Public demo content is fictional, and every AI-generated probe must be checked by a human tutor.
