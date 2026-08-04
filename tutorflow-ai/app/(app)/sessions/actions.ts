"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/guards";
import { createActionDatabaseClient } from "@/lib/db/action";
import { sessionInputSchema, type SessionInput } from "@/lib/validation/session";

export type SessionActionState = { message?: string; fieldErrors?: Record<string, string[]> };

function values(formData: FormData) {
  return {
    studentId: String(formData.get("studentId") ?? ""),
    sessionDate: String(formData.get("sessionDate") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    understanding: Number(formData.get("understanding")),
    summary: String(formData.get("summary") ?? ""),
    difficultyNotes: String(formData.get("difficultyNotes") ?? "") || undefined,
    nextGoal: String(formData.get("nextGoal") ?? "") || undefined,
    privateNotes: String(formData.get("privateNotes") ?? "") || undefined,
    usedMaterialIds: formData.getAll("usedMaterialIds").map(String),
  };
}

async function attachVerifiedMaterials(
  db: Awaited<ReturnType<typeof createActionDatabaseClient>>,
  sessionId: string,
  studentId: string,
  ids: string[],
) {
  if (ids.length) {
    const { data, error } = await db.from("materials").select("id,state,student_id").in("id", ids);
    if (error || !data || data.length !== ids.length || data.some((item) => item.state !== "verified" || item.student_id !== studentId)) {
      throw new Error("verified_materials_only");
    }
  }
  const detached = await db.from("materials").update({ session_id: null, updated_at: new Date().toISOString() }).eq("session_id", sessionId);
  if (detached.error) throw new Error("material_attach_failed");
  if (ids.length) {
    const attached = await db.from("materials").update({ session_id: sessionId, updated_at: new Date().toISOString() }).in("id", ids);
    if (attached.error) throw new Error("material_attach_failed");
  }
}

function row(input: SessionInput) {
  return {
    student_id: input.studentId,
    session_date: input.sessionDate,
    topic: input.topic,
    understanding: input.understanding,
    summary: input.summary,
    difficulty_notes: input.difficultyNotes || null,
    next_goal: input.nextGoal || null,
    private_notes: input.privateNotes || null,
  };
}

export async function createSession(_state: SessionActionState, formData: FormData): Promise<SessionActionState> {
  const parsed = sessionInputSchema.safeParse(values(formData));
  if (!parsed.success) return { message: "\u5165\u529b\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", fieldErrors: parsed.error.flatten().fieldErrors };
  await requireProfile();
  const db = await createActionDatabaseClient();
  const { data, error } = await db.from("sessions").insert(row(parsed.data)).select("id").single();
  if (error || !data) return { message: "\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002" };
  try {
    await attachVerifiedMaterials(db, data.id, parsed.data.studentId, parsed.data.usedMaterialIds);
  } catch {
    await db.from("sessions").delete().eq("id", data.id);
    return { message: "\u78ba\u8a8d\u6e08\u307f\u306e\u6559\u6750\u3060\u3051\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002" };
  }
  redirect(`/students/${parsed.data.studentId}`);
}

export async function updateSession(id: string, _state: SessionActionState, formData: FormData): Promise<SessionActionState> {
  const parsed = sessionInputSchema.safeParse(values(formData));
  if (!parsed.success) return { message: "\u5165\u529b\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", fieldErrors: parsed.error.flatten().fieldErrors };
  await requireProfile();
  const db = await createActionDatabaseClient();
  const existing = await db.from("sessions").select("id").eq("id", id).maybeSingle();
  if (!existing.data) return { message: "\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002" };
  const { error } = await db.from("sessions").update({ ...row(parsed.data), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { message: "\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u3092\u66f4\u65b0\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002" };
  try {
    await attachVerifiedMaterials(db, id, parsed.data.studentId, parsed.data.usedMaterialIds);
  } catch {
    return { message: "\u78ba\u8a8d\u6e08\u307f\u306e\u6559\u6750\u3060\u3051\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002" };
  }
  revalidatePath(`/sessions/${id}/edit`);
  return { message: "\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002" };
}

export async function deleteSession(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await requireProfile();
  const db = await createActionDatabaseClient();
  const { data } = await db.from("sessions").select("student_id").eq("id", id).maybeSingle();
  if (!data) throw new Error("session_not_found");
  const { error } = await db.from("sessions").delete().eq("id", id);
  if (error) throw new Error("session_delete_failed");
  redirect(`/students/${data.student_id}`);
}

export async function attachMaterialsToSession(sessionId: string, studentId: string, materialIds: string[]) {
  await requireProfile();
  const db = await createActionDatabaseClient();
  await attachVerifiedMaterials(db, sessionId, studentId, materialIds);
  revalidatePath(`/sessions/${sessionId}/edit`);
}
