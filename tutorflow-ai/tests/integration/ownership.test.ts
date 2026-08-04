import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "../../lib/db/types";

const enabled = Boolean(process.env.SUPABASE_TEST_URL);
function client(token?: string) { return createClient<Database>(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false }, global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined }); }

describe.skipIf(!process.env.SUPABASE_TEST_URL)("owner-scoped RLS", () => {
  it("owner can create student and consultation", async () => {
    expect(enabled).toBe(true);
    const db = client(process.env.SUPABASE_TEST_OWNER_JWT);
    const ownerId = process.env.SUPABASE_TEST_OWNER_ID!;
    const student = await db.from("students").insert({ owner_id: ownerId, alias: `Integration ${Date.now()}` }).select("id").single();
    expect(student.error).toBeNull();
    const consultation = await db.from("consultations").insert({ student_id: student.data!.id, target_concept_id: process.env.SUPABASE_TEST_CONCEPT_ID!, topic: "Integration diagnosis" });
    expect(consultation.error).toBeNull();
    await db.from("students").delete().eq("id", student.data!.id);
  });
  it("demo account cannot read owner students", async () => { const result = await client(process.env.SUPABASE_TEST_DEMO_JWT).from("students").select("id").eq("owner_id", process.env.SUPABASE_TEST_OWNER_ID!); expect(result.data).toEqual([]); });
  it("demo account cannot read owner consultations", async () => { const result = await client(process.env.SUPABASE_TEST_DEMO_JWT).from("consultations").select("id").eq("student_id", process.env.SUPABASE_TEST_OWNER_STUDENT_ID!); expect(result.data).toEqual([]); });
  it("demo account cannot read owner probes", async () => { const result = await client(process.env.SUPABASE_TEST_DEMO_JWT).from("probes").select("id"); expect(result.data).toEqual([]); });
  it("demo account cannot read owner materials", async () => { const result = await client(process.env.SUPABASE_TEST_DEMO_JWT).from("materials").select("id").eq("student_id", process.env.SUPABASE_TEST_OWNER_STUDENT_ID!); expect(result.data).toEqual([]); });
  it("demo account cannot update owner student", async () => { const result = await client(process.env.SUPABASE_TEST_DEMO_JWT).from("students").update({ alias: "blocked" }).eq("id", process.env.SUPABASE_TEST_OWNER_STUDENT_ID!).select("id"); expect(result.data).toEqual([]); });
  it("anonymous client reads nothing from any table", async () => { for (const table of ["profiles", "students", "concepts", "concept_edges", "consultations", "materials", "probes", "generation_runs"] as const) { const result = await client().from(table).select("*"); expect(result.data).toEqual([]); } });
});
