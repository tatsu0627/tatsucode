# TutorFlow AI contributor guide

## Fixed stack

- Node.js 22, npm, Next.js 15 App Router without `src/`
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Tailwind CSS 4 configured in `app/globals.css`
- Supabase PostgreSQL/Auth with `@supabase/supabase-js` and `@supabase/ssr`
- Zod 4 top-level format APIs, OpenAI SDK, Vitest 3, Playwright

Do not add an ORM, state-management package, tRPC, another auth provider, KaTeX, Redis, or a service-role client to an application request path.

## Non-negotiable constraints

- A material may have `session_id` only while its state is `verified`; preserve the database CHECK constraint.
- Material transitions are `unverified -> verified` and `unverified -> discarded` only.
- RLS remains owner-scoped and has no anonymous policies.
- AI output must pass Zod structural validation and `assertMatchesRequest`.
- `buildUserPrompt` accepts topic, difficulty, problem count, and learning objective only.
- Never log prompt text, AI response text, student aliases, or private notes.
- Display material state using words as well as color.

## Required checks

```text
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Integration and E2E tests require a dedicated Supabase test project and must remain guarded or explicitly reported as unexecuted.
