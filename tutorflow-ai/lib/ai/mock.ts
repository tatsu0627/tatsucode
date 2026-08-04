import "server-only";

import type { MaterialDraft } from "@/lib/validation/ai-output";
import type { GenerateRequest } from "@/lib/validation/material";

function problem(index: number) {
  return {
    question: `Practice problem ${index + 1}: Solve 2x + ${index + 3} = ${index + 11}.`,
    hints: ["Isolate the term containing x.", "Subtract the constant from both sides."],
    solution_steps: [`Subtract ${index + 3} from both sides.`, "Divide both sides by 2.", "Substitute the result to check."],
    common_mistakes: ["Changing a sign on only one side of the equation."],
  };
}

export function validMockDraft(request: GenerateRequest): MaterialDraft {
  return {
    topic: request.topic,
    difficulty: request.difficulty,
    learning_objective: request.learningObjective,
    problems: Array.from({ length: request.problemCount }, (_, index) => problem(index)),
    review_warning: "AI-generated draft. Verify all mathematics before use.",
  };
}

export const invalidMockFixtures = {
  problemCountMismatch: (request: GenerateRequest): MaterialDraft => ({ ...validMockDraft(request), problems: [problem(0)] }),
  difficultyMismatch: (request: GenerateRequest): MaterialDraft => ({ ...validMockDraft(request), difficulty: request.difficulty === "advanced" ? "introductory" : "advanced" }),
  emptyHints: (request: GenerateRequest) => ({ ...validMockDraft(request), problems: [{ ...problem(0), hints: [] }] }),
};

export function mockDraft(request: GenerateRequest) {
  return { draft: validMockDraft(request), latencyMs: 250, modelLabel: "mock-gpt-5.6-luna" };
}
