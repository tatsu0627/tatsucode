"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/guards";
import { createActionDatabaseClient } from "@/lib/db/action";

export async function resetDemoData() {
  const profile = await requireProfile();
  if (!profile.is_demo) throw new Error("demo_only");
  const db = await createActionDatabaseClient();
  const { error } = await db.rpc("seed_demo_workspace", { demo_id: profile.id });
  if (error) throw new Error("reset_failed");
  revalidatePath("/home");
  revalidatePath("/library");
}
