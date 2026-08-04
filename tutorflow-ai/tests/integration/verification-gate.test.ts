import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { checkGenerationLimit, RateLimitError } from "../../lib/ai/rate-limit";
import type { Database, Json } from "../../lib/db/types";

const draft: Json = { topic: "Integration", difficulty: "standard", learning_objective: "Verify database constraints", problems: [{ question: "Solve 2x=4.", hints: ["Divide both sides."], solution_steps: ["x=2"], common_mistakes: [] }], review_warning: "AI-generated draft. Verify all mathematics before use." };
function admin() { return createClient<Database>(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }); }
async function insertMaterial(state: "unverified" | "verified" | "discarded", overrides: Record<string, unknown> = {}) {
  return admin().from("materials").insert({ student_id: process.env.SUPABASE_TEST_OWNER_STUDENT_ID!, topic: "Integration", difficulty: "standard", state, ai_draft: draft, prompt_version: "test", model_label: "mock", ...(state === "verified" ? { verified_content: draft, verified_at: new Date().toISOString() } : {}), ...overrides }).select("id").single();
}

describe.skipIf(!process.env.SUPABASE_TEST_URL)("verification gate", () => {
  it("db rejects linking an unverified material to a session", async () => { const result = await insertMaterial("unverified", { session_id: process.env.SUPABASE_TEST_SESSION_ID! }); expect(result.error?.message).toMatch(/materials_session_requires_verified/); });
  it("db rejects linking a discarded material to a session", async () => { const result = await insertMaterial("discarded", { session_id: process.env.SUPABASE_TEST_SESSION_ID!, discard_reason: "test" }); expect(result.error?.message).toMatch(/materials_session_requires_verified/); });
  it("db accepts linking a verified material", async () => { const result = await insertMaterial("verified", { session_id: process.env.SUPABASE_TEST_SESSION_ID! }); expect(result.error).toBeNull(); if (result.data) await admin().from("materials").delete().eq("id", result.data.id); });
  it("db rejects verified state without verified_content", async () => { const result = await insertMaterial("verified", { verified_content: null }); expect(result.error?.message).toMatch(/materials_verified_consistency/); });
  it("verifying sets verified_at", async () => { const material = await insertMaterial("unverified"); const result = await admin().from("materials").update({ state: "verified", verified_content: draft, verified_at: new Date().toISOString() }).eq("id", material.data!.id).select("verified_at").single(); expect(result.data?.verified_at).toBeTruthy(); await admin().from("materials").delete().eq("id", material.data!.id); });
  it("failed generation is recorded with success=false", async () => { const result = await admin().from("generation_runs").insert({ owner_id: process.env.SUPABASE_TEST_OWNER_ID!, model_label: "mock", prompt_version: "test", latency_ms: 1, success: false, validation_error: "fixture" }).select("success").single(); expect(result.data?.success).toBe(false); });
  it("demo rate limit blocks the 4th generation in an hour", async () => {
    const db = admin();
    const demoId = process.env.SUPABASE_TEST_DEMO_ID!;
    await db.from("generation_runs").delete().eq("owner_id", demoId);
    for (let index = 0; index < 3; index += 1) {
      await db.from("generation_runs").insert({ owner_id: demoId, model_label: "mock", prompt_version: "test", latency_ms: 1, success: true });
    }
    await expect(checkGenerationLimit(db, { id: demoId, display_name: "Demo", is_demo: true, created_at: new Date().toISOString() })).rejects.toBeInstanceOf(RateLimitError);
    await db.from("generation_runs").delete().eq("owner_id", demoId);
  });
});
