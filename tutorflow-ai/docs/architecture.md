# Architecture

```mermaid
flowchart LR
  Tutor["Tutor browser"] --> Next["Next.js 15 App Router"]
  Next --> Auth["Supabase Auth"]
  Next --> DB["PostgreSQL + RLS"]
  DB --> Graph["Concept graph"]
  Graph --> Engine["Pure diagnosis engine"]
  Engine --> Choice["Next unknown probe"]
  Choice --> Existing{"Verified probe exists?"}
  Existing -->|yes| Student["Student display"]
  Existing -->|no| AI["GPT-5.6 Luna draft"]
  AI --> Zod["Zod structured output"]
  Zod --> Review["Tutor review"]
  Review --> Verified["Verified material"]
  Verified --> Student
  Student --> Result["Solved / failed / skipped"]
  Result --> Gate["Probe CHECK + composite FK"]
  Gate --> DB
```

The browser never receives the OpenAI key or service-role key. Server Components use the read-oriented Supabase client; Server Actions and Route Handlers use the cookie-writing action client. The three existing clients remain separate.

`lib/diagnosis/engine.ts` has no database or React dependency. A Server Component loads concepts, edges, and persisted probe observations, reconstructs state, and passes only a verified problem into the client-side student display.

The AI probe prompt accepts only a concept code and English label. Student aliases, consultation notes, and private notes cannot enter its function signature.

Unverified material can appear only as a tutor-facing review link. Its JSON content is not selected for or passed to the student display.
