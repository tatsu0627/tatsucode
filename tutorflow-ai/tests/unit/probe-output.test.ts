import { describe, expect, it } from "vitest";
import { probeDraftSchema } from "../../lib/validation/probe-output";

const valid = {
  concept_code: "integer-operations",
  topic: "Integer operations",
  difficulty: "introductory",
  learning_objective: "Check operations with signed integers",
  problems: [{
    question: "Evaluate -7 + 12 - 3.",
    hints: ["Combine the first two integers."],
    solution_steps: ["-7 + 12 = 5.", "5 - 3 = 2."],
    common_mistakes: ["Ignoring the negative sign."],
  }],
  review_warning: "AI-generated draft. Verify all mathematics before use.",
};

describe("probe output validation", () => {
  it("accepts one structured probe for a concept code", () => expect(probeDraftSchema.safeParse(valid).success).toBe(true));
  it("rejects a probe with more than one problem", () => expect(probeDraftSchema.safeParse({ ...valid, problems: [valid.problems[0], valid.problems[0]] }).success).toBe(false));
  it("rejects a malformed concept code", () => expect(probeDraftSchema.safeParse({ ...valid, concept_code: "Integer Operations" }).success).toBe(false));
});
