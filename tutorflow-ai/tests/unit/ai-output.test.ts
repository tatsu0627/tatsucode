import { describe, expect, it } from "vitest";
import { materialDraftSchema } from "../../lib/validation/ai-output";
import { assertMatchesRequest } from "../../lib/validation/material";

const request = { studentId: "10000000-0000-4000-8000-000000000001", topic: "Linear equations", difficulty: "standard" as const, problemCount: 1, learningObjective: "Solve equations and verify the result" };
const valid = { topic: request.topic, difficulty: request.difficulty, learning_objective: request.learningObjective, problems: [{ question: "Solve 2x + 3 = 11.", hints: ["Subtract 3 first."], solution_steps: ["2x = 8", "x = 4"], common_mistakes: ["Dividing before subtracting."] }], review_warning: "AI-generated draft. Verify all mathematics before use." };

describe("AI output validation", () => {
  it("accepts a valid draft", () => expect(materialDraftSchema.safeParse(valid).success).toBe(true));
  it("rejects missing problems field", () => { const missing: Record<string, unknown> = { ...valid }; delete missing.problems; expect(materialDraftSchema.safeParse(missing).success).toBe(false); });
  it("rejects unknown difficulty value", () => expect(materialDraftSchema.safeParse({ ...valid, difficulty: "expert" }).success).toBe(false));
  it("rejects empty hints array", () => expect(materialDraftSchema.safeParse({ ...valid, problems: [{ ...valid.problems[0], hints: [] }] }).success).toBe(false));
  it("rejects empty solution_steps array", () => expect(materialDraftSchema.safeParse({ ...valid, problems: [{ ...valid.problems[0], solution_steps: [] }] }).success).toBe(false));
  it("rejects a hint that is an empty string", () => expect(materialDraftSchema.safeParse({ ...valid, problems: [{ ...valid.problems[0], hints: [""] }] }).success).toBe(false));
  it("rejects more than 5 problems", () => expect(materialDraftSchema.safeParse({ ...valid, problems: Array.from({ length: 6 }, () => valid.problems[0]) }).success).toBe(false));
  it("assertMatchesRequest rejects problem count mismatch", () => expect(() => assertMatchesRequest(valid, { ...request, problemCount: 2 })).toThrow(/problem count mismatch/));
  it("assertMatchesRequest rejects difficulty mismatch", () => expect(() => assertMatchesRequest(valid, { ...request, difficulty: "advanced" })).toThrow(/difficulty mismatch/));
});
