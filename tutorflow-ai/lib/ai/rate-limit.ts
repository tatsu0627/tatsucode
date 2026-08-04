import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/lib/db/types";

export class RateLimitError extends Error {}

export async function checkGenerationLimit(db: SupabaseClient<Database>, profile: Profile) {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error } = await db.from("generation_runs").select("id", { count: "exact", head: true }).eq("owner_id", profile.id).gte("created_at", since);
  if (error) throw new Error("rate_limit_lookup_failed");
  const limit = profile.is_demo
    ? Number(process.env.GENERATION_RATE_LIMIT_DEMO ?? 3)
    : Number(process.env.GENERATION_RATE_LIMIT_OWNER ?? 20);
  if ((count ?? 0) >= limit) throw new RateLimitError(`limit_${limit}`);
}
