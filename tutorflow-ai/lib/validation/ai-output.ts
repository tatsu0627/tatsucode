import { z } from "zod";

export const DIFFICULTIES = ["introductory", "standard", "advanced"] as const;

export const problemSchema = z.object({
  question: z.string().min(5).max(1000),
  hints: z.array(z.string().min(1).max(500)).min(1).max(4),
  solution_steps: z.array(z.string().min(1).max(500)).min(1).max(10),
  common_mistakes: z.array(z.string().min(1).max(300)).max(5),
});

export const materialDraftSchema = z.object({
  topic: z.string().min(1).max(100),
  difficulty: z.enum(DIFFICULTIES),
  learning_objective: z.string().min(5).max(300),
  problems: z.array(problemSchema).min(1).max(5),
  review_warning: z.string().min(1),
});

export type MaterialDraft = z.infer<typeof materialDraftSchema>;
export type Problem = z.infer<typeof problemSchema>;
