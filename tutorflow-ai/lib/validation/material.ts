import { z } from "zod";
import { DIFFICULTIES, type MaterialDraft } from "./ai-output";
import type { MaterialState } from "@/lib/db/types";

export const generateRequestSchema = z.object({
  studentId: z.uuid(),
  topic: z.string().trim().min(1).max(100),
  difficulty: z.enum(DIFFICULTIES),
  problemCount: z.number().int().min(1).max(5),
  learningObjective: z.string().trim().min(5).max(300),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export class ValidationError extends Error {}

export function assertMatchesRequest(draft: MaterialDraft, request: GenerateRequest) {
  if (draft.problems.length !== request.problemCount) {
    throw new ValidationError(`problem count mismatch: requested ${request.problemCount}, got ${draft.problems.length}`);
  }
  if (draft.difficulty !== request.difficulty) {
    throw new ValidationError(`difficulty mismatch: requested ${request.difficulty}, got ${draft.difficulty}`);
  }
}

export function canAttachToSession(state: MaterialState) {
  return state === "verified";
}

export function nextState(current: MaterialState, target: MaterialState): MaterialState {
  if (current !== "unverified" || !["verified", "discarded"].includes(target)) {
    throw new ValidationError(`invalid material transition: ${current} -> ${target}`);
  }
  return target;
}
