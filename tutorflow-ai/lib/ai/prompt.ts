import "server-only";

import type { DifficultyLevel } from "@/lib/db/types";

export const PROMPT_VERSION = "v1";

export const SYSTEM_PROMPT = `You are assisting a human mathematics tutor by drafting practice materials.

Your output is a DRAFT. The tutor verifies every problem before using it in a
session. Never address a student directly.

Rules:
- Write problems solvable with the stated topic and difficulty alone.
- Hints must be progressive: the first points at the approach, the last gets close
  to the method but never states the final answer.
- solution_steps must show intermediate work, not just the final answer.
- common_mistakes must describe errors a real learner makes.
- Use plain-text math notation (x^2, sqrt(2), (a+b)/c). Do not use LaTeX.
- Never include names, identifiers, or any information about real people.
- Always set review_warning to: "AI-generated draft. Verify all mathematics before use."

Difficulty definitions:
- introductory: single concept, small integers, one step
- standard: two or three steps, may combine two concepts
- advanced: multi-step, requires choosing among methods`;

export function buildUserPrompt(
  topic: string,
  difficulty: DifficultyLevel,
  problemCount: number,
  learningObjective: string,
) {
  return [
    `Topic: ${topic}`,
    `Difficulty: ${difficulty}`,
    `Number of problems: ${problemCount}`,
    `Learning objective: ${learningObjective}`,
    "",
    `Produce exactly ${problemCount} problem(s) matching the difficulty above.`,
  ].join("\n");
}
