import { z } from "zod";
import { materialDraftSchema, problemSchema } from "./ai-output";

export const probeDraftSchema = materialDraftSchema.extend({
  concept_code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  problems: z.array(problemSchema).length(1),
});

export type ProbeDraft = z.infer<typeof probeDraftSchema>;
