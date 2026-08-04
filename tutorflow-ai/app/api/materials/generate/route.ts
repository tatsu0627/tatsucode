import { NextResponse } from "next/server";
import { createActionDatabaseClient } from "@/lib/db/action";
import type { Json, Profile } from "@/lib/db/types";
import { generateRequestSchema, ValidationError } from "@/lib/validation/material";
import { generateMaterialDraft, AiInvalidOutputError, AiUnavailableError } from "@/lib/ai/generate";
import { checkGenerationLimit, RateLimitError } from "@/lib/ai/rate-limit";
import { PROMPT_VERSION } from "@/lib/ai/prompt";

export const maxDuration = 60;

type ErrorCode = "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "AI_UNAVAILABLE" | "AI_INVALID_OUTPUT";

function apiError(code: ErrorCode, message: string, status: number, retryable = false) {
  return NextResponse.json({ error: { code, message, retryable } }, { status });
}

export async function POST(request: Request) {
  const db = await createActionDatabaseClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return apiError("UNAUTHORIZED", "\u30ed\u30b0\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044\u3002", 401);
  const profileResult = await db.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (!profileResult.data) return apiError("UNAUTHORIZED", "\u30d7\u30ed\u30d5\u30a3\u30fc\u30eb\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002", 401);
  const profile: Profile = profileResult.data;

  let body: unknown;
  try { body = await request.json(); } catch { return apiError("VALIDATION", "\u5165\u529b\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", 400); }
  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION", "\u5206\u91ce\u3001\u96e3\u6613\u5ea6\u3001\u554f\u984c\u6570\u3001\u5b66\u7fd2\u76ee\u6a19\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", 400);
  const student = await db.from("students").select("id").eq("id", parsed.data.studentId).eq("owner_id", profile.id).maybeSingle();
  if (!student.data) return apiError("FORBIDDEN", "\u3053\u306e\u5b66\u751f\u306e\u6559\u6750\u306f\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3002", 403);

  try {
    await checkGenerationLimit(db, profile);
  } catch (error) {
    if (error instanceof RateLimitError) return apiError("RATE_LIMITED", "\u751f\u6210\u56de\u6570\u306e\u4e0a\u9650\u306b\u9054\u3057\u307e\u3057\u305f\u30021\u6642\u9593\u5f8c\u306b\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002", 429, true);
    return apiError("AI_UNAVAILABLE", "\u751f\u6210\u6e96\u5099\u4e2d\u306b\u554f\u984c\u304c\u8d77\u304d\u307e\u3057\u305f\u3002", 502, true);
  }

  const promptVersion = process.env.PROMPT_VERSION ?? PROMPT_VERSION;
  const started = Date.now();
  let runId: string | null = null;
  try {
    const pendingRun = await db.from("generation_runs").insert({ owner_id: profile.id, model_label: process.env.AI_MODEL ?? "gpt-5.6-luna", prompt_version: promptVersion, latency_ms: 0, success: false, validation_error: "pending" }).select("id").single();
    if (pendingRun.error || !pendingRun.data) throw new AiUnavailableError("generation_run_save_failed");
    runId = pendingRun.data.id;
    const result = await generateMaterialDraft(parsed.data);
    const inserted = await db.from("materials").insert({
      student_id: parsed.data.studentId,
      topic: parsed.data.topic,
      difficulty: parsed.data.difficulty,
      state: "unverified",
      ai_draft: result.draft as Json,
      prompt_version: promptVersion,
      model_label: result.modelLabel,
    }).select("id").single();
    if (inserted.error || !inserted.data) throw new AiUnavailableError("material_save_failed");
    await db.from("generation_runs").update({ material_id: inserted.data.id, model_label: result.modelLabel, latency_ms: result.latencyMs, success: true, validation_error: null }).eq("id", runId);
    return NextResponse.json({ materialId: inserted.data.id, draft: result.draft });
  } catch (error) {
    const latencyMs = Date.now() - started;
    const code = error instanceof AiInvalidOutputError || error instanceof ValidationError ? "AI_INVALID_OUTPUT" : "AI_UNAVAILABLE";
    if (runId) await db.from("generation_runs").update({ success: false, latency_ms: Math.max(0, latencyMs), validation_error: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }).eq("id", runId);
    console.error({ code, materialId: null, ownerId: profile.id, latencyMs });
    if (code === "AI_INVALID_OUTPUT") return apiError(code, "AI\u306e\u4e0b\u66f8\u304d\u304c\u6307\u5b9a\u6761\u4ef6\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u6761\u4ef6\u3092\u898b\u76f4\u3057\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002", 422);
    return apiError(code, "\u73fe\u5728AI\u306b\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093\u3002\u5165\u529b\u306f\u305d\u306e\u307e\u307e\u3067\u3059\u306e\u3067\u3001\u6642\u9593\u3092\u304a\u3044\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002", 502, true);
  }
}
