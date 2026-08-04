# Architecture

```mermaid
flowchart LR
  Browser["Tutor browser"] --> Next["Next.js 15 App Router"]
  Next --> Auth["Supabase Auth"]
  Next --> DB["PostgreSQL + owner-scoped RLS"]
  Next --> AI["OpenAI structured output"]
  AI --> Validate["Zod + request matching"]
  Validate --> Review["Human review"]
  Review --> Gate["Database verification gate"]
  Gate --> Session["Session mode"]
```

The browser never receives the OpenAI key or service-role key. Server Components use a read-oriented Supabase client whose cookie writes are safely ignored; Server Actions and Route Handlers use a separate client that can refresh authentication cookies.

The AI prompt builder accepts only topic, difficulty, problem count, and learning objective. Student aliases and private notes do not fit its function signature.
