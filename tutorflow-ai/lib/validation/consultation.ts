import { z } from "zod";

export const consultationInputSchema = z.object({
  studentId: z.uuid(),
  targetConceptId: z.uuid(),
  consultationDate: z.iso.date(),
  topic: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).default(""),
  privateNotes: z.string().trim().max(2000).optional(),
});

export const probeResultInputSchema = z.object({
  consultationId: z.uuid(),
  conceptId: z.uuid(),
  materialId: z.uuid(),
  result: z.enum(["solved", "failed", "skipped"]),
});

export const probeGenerateRequestSchema = z.object({
  consultationId: z.uuid(),
  conceptId: z.uuid(),
});

export type ConsultationInput = z.infer<typeof consultationInputSchema>;
