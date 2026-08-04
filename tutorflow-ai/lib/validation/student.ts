import { z } from "zod";

export const studentInputSchema = z.object({
  alias: z.string().trim().min(1).max(50),
  currentLevel: z.string().trim().max(100).optional(),
  learningGoal: z.string().trim().max(500).optional(),
});

export type StudentInput = z.infer<typeof studentInputSchema>;
