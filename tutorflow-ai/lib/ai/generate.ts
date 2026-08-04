import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { getOpenAIClient } from "./client";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { mockDraft } from "./mock";
import { materialDraftSchema, type MaterialDraft } from "@/lib/validation/ai-output";
import { assertMatchesRequest, type GenerateRequest, ValidationError } from "@/lib/validation/material";

export class AiUnavailableError extends Error {}
export class AiInvalidOutputError extends Error {}

export type GenerateResult = { draft: MaterialDraft; latencyMs: number; modelLabel: string };

const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

function reasoningEffort(): ReasoningEffort {
  const configured = process.env.AI_EFFORT ?? "medium";
  return REASONING_EFFORTS.includes(configured as ReasoningEffort) ? configured as ReasoningEffort : "medium";
}

export async function generateMaterialDraft(request: GenerateRequest): Promise<GenerateResult> {
  if (process.env.MOCK_AI === "1" && process.env.NODE_ENV !== "production") return mockDraft(request);

  const model = process.env.AI_MODEL ?? "gpt-5.6-luna";
  const started = Date.now();
  let response;
  try {
    response = await getOpenAIClient().responses.parse({
      model,
      max_output_tokens: 16000,
      reasoning: { effort: reasoningEffort() },
      store: false,
      instructions: SYSTEM_PROMPT,
      input: buildUserPrompt(request.topic, request.difficulty, request.problemCount, request.learningObjective),
      text: { format: zodTextFormat(materialDraftSchema, "material_draft") },
    });
  } catch (error) {
    if (error instanceof OpenAI.RateLimitError) throw new AiUnavailableError("rate_limited");
    if (error instanceof OpenAI.APIConnectionError) throw new AiUnavailableError("network");
    if (error instanceof OpenAI.APIError) throw new AiUnavailableError(`api_${error.status}`);
    if (error instanceof ZodError || error instanceof SyntaxError) throw new AiInvalidOutputError("schema_parse_failed");
    throw error;
  }

  const latencyMs = Date.now() - started;
  const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
  if (refused) throw new AiInvalidOutputError("refused");
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    if (reason === "max_output_tokens") throw new AiInvalidOutputError("truncated");
    throw new AiInvalidOutputError(`incomplete_${reason ?? "unknown"}`);
  }
  if (response.status !== "completed") throw new AiUnavailableError(`response_${response.status}`);
  if (!response.output_parsed) throw new AiInvalidOutputError("schema_parse_failed");

  const draft = response.output_parsed;
  try {
    assertMatchesRequest(draft, request);
  } catch (error) {
    if (error instanceof ValidationError) throw new AiInvalidOutputError(error.message);
    throw error;
  }
  return { draft, latencyMs, modelLabel: model };
}
