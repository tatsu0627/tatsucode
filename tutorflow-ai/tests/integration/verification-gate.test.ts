import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { checkGenerationLimit, RateLimitError } from "../../lib/ai/rate-limit";
import type { Database, Json, MaterialState } from "../../lib/db/types";

const draft: Json = { topic: "Integration", difficulty: "standard", learning_objective: "Verify database constraints", problems: [{ question: "Solve 2x=4.", hints: ["Divide both sides."], solution_steps: ["x=2"], common_mistakes: [] }], review_warning: "AI-generated draft. Verify all mathematics before use." };
function admin() { return createClient<Database>(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }); }
async function insertMaterial(state: MaterialState, overrides: Database["public"]["Tables"]["materials"]["Insert"] extends infer Row ? Partial<Row> : never = {}) {
  return admin().from("materials").insert({ student_id: process.env.SUPABASE_TEST_OWNER_STUDENT_ID!, concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, kind: "probe", topic: "Integration", difficulty: "standard", state, ai_draft: draft, prompt_version: "test", model_label: "mock", ...(state === "verified" ? { verified_content: draft, verified_at: new Date().toISOString() } : {}), ...overrides }).select("id,state,kind").single();
}
async function insertConsultation() {
  return admin().from("consultations").insert({ student_id: process.env.SUPABASE_TEST_OWNER_STUDENT_ID!, target_concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, topic: "Integration diagnosis" }).select("id").single();
}
async function cleanup(consultationId?: string, materialId?: string) {
  const db = admin();
  if (consultationId) await db.from("consultations").delete().eq("id", consultationId);
  if (materialId) await db.from("materials").delete().eq("id", materialId);
}

describe.skipIf(!process.env.SUPABASE_TEST_URL)("verification gate", () => {
  it("db rejects a probe referencing an unverified material", async () => {
    const material = await insertMaterial("unverified");
    const consultation = await insertConsultation();
    const result = await admin().from("probes").insert({ consultation_id: consultation.data!.id, concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, material_id: material.data!.id, material_state: "verified", result: "failed", step: 1 });
    expect(result.error?.message).toMatch(/probes_material_fk|foreign key/i);
    await cleanup(consultation.data?.id, material.data?.id);
  });

  it("db rejects a probe referencing a discarded material", async () => {
    const material = await insertMaterial("discarded");
    const consultation = await insertConsultation();
    const result = await admin().from("probes").insert({ consultation_id: consultation.data!.id, concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, material_id: material.data!.id, material_state: "verified", result: "failed", step: 1 });
    expect(result.error?.message).toMatch(/probes_material_fk|foreign key/i);
    await cleanup(consultation.data?.id, material.data?.id);
  });

  it("db rejects un-verifying a material that a probe references", async () => {
    const material = await insertMaterial("verified");
    const consultation = await insertConsultation();
    const probe = await admin().from("probes").insert({ consultation_id: consultation.data!.id, concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, material_id: material.data!.id, material_state: "verified", result: "solved", step: 1 });
    expect(probe.error).toBeNull();
    const result = await admin().from("materials").update({ state: "unverified" }).eq("id", material.data!.id);
    expect(result.error?.message).toMatch(/probes_material_must_be_verified|check constraint/i);
    await cleanup(consultation.data?.id, material.data?.id);
  });

  it("db accepts a probe referencing a verified material", async () => {
    const material = await insertMaterial("verified");
    const consultation = await insertConsultation();
    const result = await admin().from("probes").insert({ consultation_id: consultation.data!.id, concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, material_id: material.data!.id, material_state: "verified", result: "solved", step: 1 });
    expect(result.error).toBeNull();
    await cleanup(consultation.data?.id, material.data?.id);
  });

  it("db rejects verified state without verified_content", async () => { const result = await insertMaterial("verified", { verified_content: null }); expect(result.error?.message).toMatch(/materials_verified_consistency/); });

  it("failed generation is recorded with success=false", async () => { const result = await admin().from("generation_runs").insert({ owner_id: process.env.SUPABASE_TEST_OWNER_ID!, model_label: "mock", prompt_version: "test", latency_ms: 1, success: false, validation_error: "fixture" }).select("success").single(); expect(result.data?.success).toBe(false); });

  it("demo rate limit blocks the 4th generation in an hour", async () => {
    const db = admin();
    const demoId = process.env.SUPABASE_TEST_DEMO_ID!;
    await db.from("generation_runs").delete().eq("owner_id", demoId);
    for (let index = 0; index < 3; index += 1) await db.from("generation_runs").insert({ owner_id: demoId, model_label: "mock", prompt_version: "test", latency_ms: 1, success: true });
    await expect(checkGenerationLimit(db, { id: demoId, display_name: "Demo", is_demo: true, created_at: new Date().toISOString() })).rejects.toBeInstanceOf(RateLimitError);
    await db.from("generation_runs").delete().eq("owner_id", demoId);
  });

  it("db defaults a new material to practice kind", async () => { const result = await insertMaterial("unverified", { kind: undefined }); expect(result.data?.kind).toBe("practice"); if (result.data) await admin().from("materials").delete().eq("id", result.data.id); });
});
