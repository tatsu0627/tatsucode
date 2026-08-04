import { describe, expect, it } from "vitest";
import { consultationInputSchema, probeResultInputSchema } from "../../lib/validation/consultation";

const valid = {
  studentId: "10000000-0000-4000-8000-000000000001",
  targetConceptId: "50000000-0000-4000-8000-000000000018",
  consultationDate: "2026-08-04",
  topic: "Quadratic equation diagnosis",
  summary: "Drop-in consultation started.",
};

describe("consultation input validation", () => {
  it("accepts a valid consultation", () => expect(consultationInputSchema.safeParse(valid).success).toBe(true));
  it("rejects an invalid student id", () => expect(consultationInputSchema.safeParse({ ...valid, studentId: "student" }).success).toBe(false));
  it("rejects an invalid target concept id", () => expect(consultationInputSchema.safeParse({ ...valid, targetConceptId: "concept" }).success).toBe(false));
  it("rejects an invalid consultation date", () => expect(consultationInputSchema.safeParse({ ...valid, consultationDate: "08/04/2026" }).success).toBe(false));
  it("trims and rejects a whitespace-only topic", () => expect(consultationInputSchema.safeParse({ ...valid, topic: "   " }).success).toBe(false));
  it("rejects a summary over 2000 characters", () => expect(consultationInputSchema.safeParse({ ...valid, summary: "a".repeat(2001) }).success).toBe(false));
  it("rejects an unknown probe result", () => expect(probeResultInputSchema.safeParse({ consultationId: valid.studentId, conceptId: valid.targetConceptId, materialId: valid.studentId, result: "unknown" }).success).toBe(false));
});
