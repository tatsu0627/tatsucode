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

export const PROBE_PROMPT_VERSION = "probe-v1";

export const PROBE_SYSTEM_PROMPT = `You are assisting a human mathematics tutor by drafting one diagnostic probe.

Your output is a DRAFT. The tutor verifies it before any student can see it.
Create exactly one short question that isolates the named prerequisite concept.
Do not address a student and do not ask for or infer personal information.

Rules:
- Keep the question focused on only the requested concept.
- Include progressive hints that do not state the final answer.
- Show complete solution steps so the tutor can verify the mathematics.
- Include realistic common mistakes.
- Use plain-text math notation and no LaTeX.
- Always set review_warning to: "AI-generated draft. Verify all mathematics before use."`;

export function buildProbePrompt(conceptCode: string, conceptLabel: string) {
  return [
    `Concept code: ${conceptCode}`,
    `Concept label: ${conceptLabel}`,
    "",
    "Produce exactly one diagnostic problem for this concept.",
  ].join("\n");
}
