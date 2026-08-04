import { z } from "zod";

export const sessionInputSchema = z.object({
  studentId: z.uuid(),
  sessionDate: z.iso.date(),
  topic: z.string().trim().min(1).max(100),
  understanding: z.number().int().min(1).max(5),
  summary: z.string().trim().min(1).max(2000),
  difficultyNotes: z.string().trim().max(2000).optional(),
  nextGoal: z.string().trim().max(500).optional(),
  privateNotes: z.string().trim().max(2000).optional(),
  usedMaterialIds: z.array(z.uuid()).max(5).default([]),
});

export type SessionInput = z.infer<typeof sessionInputSchema>;
