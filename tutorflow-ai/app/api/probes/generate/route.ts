import { NextResponse } from "next/server";
import { createActionDatabaseClient } from "@/lib/db/action";
import type { Json, Profile } from "@/lib/db/types";
import { AiInvalidOutputError, AiUnavailableError, generateProbeDraft } from "@/lib/ai/generate";
import { checkGenerationLimit, RateLimitError } from "@/lib/ai/rate-limit";
import { PROBE_PROMPT_VERSION } from "@/lib/ai/prompt";
import { probeGenerateRequestSchema } from "@/lib/validation/consultation";

export const maxDuration = 60;

type ErrorCode = "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "RATE_LIMITED" | "AI_UNAVAILABLE" | "AI_INVALID_OUTPUT";

function apiError(code: ErrorCode, message: string, status: number, retryable = false) {
  return NextResponse.json({ error: { code, message, retryable } }, { status });
}

export async function POST(request: Request) {
  const db = await createActionDatabaseClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return apiError("UNAUTHORIZED", "ログインしてください。", 401);
  const profileResult = await db.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (!profileResult.data) return apiError("UNAUTHORIZED", "プロフィールを確認できません。", 401);
  const profile: Profile = profileResult.data;

  let body: unknown;
  try { body = await request.json(); } catch { return apiError("VALIDATION", "入力内容を確認してください。", 400); }
  const parsed = probeGenerateRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION", "相談と概念を確認してください。", 400);
  const [consultation, concept] = await Promise.all([
    db.from("consultations").select("id,student_id,completed_at").eq("id", parsed.data.consultationId).maybeSingle(),
    db.from("concepts").select("id,code,label").eq("id", parsed.data.conceptId).maybeSingle(),
  ]);
  if (!consultation.data || consultation.data.completed_at || !concept.data) return apiError("FORBIDDEN", "この診断プローブは作成できません。", 403);

  const existing = await db.from("materials").select("id,ai_draft").eq("student_id", consultation.data.student_id).eq("concept_id", concept.data.id).eq("kind", "probe").eq("state", "unverified").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing.data) return NextResponse.json({ materialId: existing.data.id, draft: existing.data.ai_draft });

  try {
    await checkGenerationLimit(db, profile);
  } catch (error) {
    if (error instanceof RateLimitError) return apiError("RATE_LIMITED", "生成回数の上限に達しました。1時間後にお試しください。", 429, true);
    return apiError("AI_UNAVAILABLE", "生成準備中に問題が起きました。", 502, true);
  }

  const promptVersion = PROBE_PROMPT_VERSION;
  const started = Date.now();
  let runId: string | null = null;
  try {
    const pendingRun = await db.from("generation_runs").insert({ owner_id: profile.id, model_label: process.env.AI_MODEL ?? "gpt-5.6-luna", prompt_version: promptVersion, latency_ms: 0, success: false, validation_error: "pending" }).select("id").single();
    if (pendingRun.error || !pendingRun.data) throw new AiUnavailableError("generation_run_save_failed");
    runId = pendingRun.data.id;
    const result = await generateProbeDraft({ conceptCode: concept.data.code, conceptLabel: concept.data.label });
    const inserted = await db.from("materials").insert({
      student_id: consultation.data.student_id,
      concept_id: concept.data.id,
      kind: "probe",
      topic: `${concept.data.label} check`,
      difficulty: result.draft.difficulty,
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
    const code = error instanceof AiInvalidOutputError ? "AI_INVALID_OUTPUT" : "AI_UNAVAILABLE";
    if (runId) await db.from("generation_runs").update({ success: false, latency_ms: Math.max(0, latencyMs), validation_error: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }).eq("id", runId);
    console.error({ code, materialId: null, ownerId: profile.id, latencyMs });
    if (code === "AI_INVALID_OUTPUT") return apiError(code, "AIの診断プローブが指定概念と一致しませんでした。再試行してください。", 422);
    return apiError(code, "現在AIに接続できません。時間をおいて再試行してください。", 502, true);
  }
}
