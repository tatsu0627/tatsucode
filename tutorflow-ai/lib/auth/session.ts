import "server-only";

import { createServerDatabaseClient } from "@/lib/db/server";
import type { Profile } from "@/lib/db/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const db = await createServerDatabaseClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await db.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (error || !data) return null;
  return data;
}
