# TutorFlow AI

> This is a personal tool and portfolio project, not an official DVC product.  
> All data in the public demo is fictional.  
> Real usage stores only aliases, never student names or records.  
> AI-generated materials require human verification and may contain errors.

TutorFlow AI is a private preparation tool for a mathematics tutor. It connects short session records to the next learning goal, drafts practice material with AI, and prevents unverified material from being attached to a session.

## Demo

The demo sign-in uses a separate Supabase account containing fictional records. Account creation and hosted credentials remain a human setup task.

## Background

The product is based on the developer's mathematics tutoring experience at Diablo Valley College. It focuses on the real preparation loop: record what happened, decide what comes next, prepare material, and verify it before use.

## Problem

Learning notes and preparation easily become disconnected. AI can shorten drafting time, but its output can contain mathematical errors, unsuitable difficulty, or incomplete explanations.

## Solution

TutorFlow AI combines student aliases, session records, next goals, structured AI drafts, a human review screen, and a distraction-free session mode.

## Core Constraint

Unverified or discarded material cannot be attached to a session. The rule is enforced by the PostgreSQL `materials_session_requires_verified` CHECK constraint, not only by the interface.

## Key Features

- Owner-scoped student and session records
- Structured practice material generation with request matching checks
- Side-by-side AI draft and tutor-edited content
- Seven-item verification checklist
- Verified-only session material selection
- Progressive hint disclosure in session mode
- Separate fictional demo data with a stricter generation limit

## Screenshots

Screenshots will be added after a Supabase test project is connected and the protected flows can be exercised honestly.

## Architecture

See `docs/architecture.md`.

## Tech Stack

Next.js 15 App Router, TypeScript 5, Tailwind CSS 4, Supabase/PostgreSQL, Zod 4, OpenAI SDK, Vitest 3, and Playwright.

## Data Model

See `docs/data-model.md`.

## Security and Privacy

Row Level Security isolates each account by `auth.uid()`. Real use permits aliases and learning notes only; names, IDs, email addresses, grades, family circumstances, and health information are excluded. Student information is not accepted by the AI prompt builder.

## AI Evaluation

The evaluation template is in `docs/ai-evaluation.md`. No score is reported before running the real API evaluation.

## Local Setup

1. Use Node 22.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and set the required values.
4. Create the demo Supabase Auth user with the email address `demo@tutorflow.local`. If `DEMO_EMAIL` differs, edit the same address in `supabase/migrations/0003_seed.sql` before applying migrations.
5. Apply the files in `supabase/migrations` to a Supabase project.
6. Run `npm run dev`.

Set `MOCK_AI=1` outside production to use the deterministic local AI fixture.

## Deployment

The `/api/materials/generate` route can take around 30 seconds to complete. Its `maxDuration = 60` declaration can extend execution only up to the limit supported by the selected Vercel plan. If generation does not fit within that limit, set `AI_EFFORT=low` to reduce generation time.

## Testing

The repository separates local checks from tests that require external infrastructure. The final verification status is updated only after commands have actually run.

- Unit tests: 27 implemented and passing locally
- Integration tests: 13 implemented with an environment guard; collected successfully and skipped because no dedicated Supabase test project was provided
- E2E: 1 implemented with `MOCK_AI=1`; not run without a Supabase project
- External Supabase and OpenAI connections: not verified in the placeholder local environment

## What I Learned

The central engineering decision is to express the most important product promise at the database boundary. Structured output validation and human review solve different failure modes, so both are necessary.

## Known Limitations

- Supabase migrations and ownership tests require human-provided test and production projects.
- Real OpenAI generation and quality scoring require a human-provided API key.
- The tool is intentionally single-owner and is not a school record system.

## Future Improvements

After real use, evaluate failure patterns, refine the prompt by version, and improve review ergonomics without weakening the verification gate.

## Disclaimer

TutorFlow AI does not replace a teacher or independently validate mathematics. It is not affiliated with or endorsed by Diablo Valley College. Public demo content is fictional, and AI output must be checked by a human tutor.
