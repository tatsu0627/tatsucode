"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/guards";
import { createActionDatabaseClient } from "@/lib/db/action";
import { studentInputSchema } from "@/lib/validation/student";

export type StudentActionState = { message?: string; fieldErrors?: Record<string, string[]> };

function values(formData: FormData) {
  return {
    alias: String(formData.get("alias") ?? ""),
    currentLevel: String(formData.get("currentLevel") ?? "") || undefined,
    learningGoal: String(formData.get("learningGoal") ?? "") || undefined,
  };
}

export async function createStudent(_state: StudentActionState, formData: FormData): Promise<StudentActionState> {
  const parsed = studentInputSchema.safeParse(values(formData));
  if (!parsed.success) return { message: "\u5165\u529b\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", fieldErrors: parsed.error.flatten().fieldErrors };
  const profile = await requireProfile();
  const db = await createActionDatabaseClient();
  const { data, error } = await db.from("students").insert({
    owner_id: profile.id,
    alias: parsed.data.alias,
    current_level: parsed.data.currentLevel || null,
    learning_goal: parsed.data.learningGoal || null,
  }).select("id").single();
  if (error || !data) return { message: "\u5b66\u751f\u3092\u8ffd\u52a0\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002" };
  redirect(`/students/${data.id}`);
}

export async function updateStudent(id: string, _state: StudentActionState, formData: FormData): Promise<StudentActionState> {
  const parsed = studentInputSchema.safeParse(values(formData));
  if (!parsed.success) return { message: "\u5165\u529b\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002", fieldErrors: parsed.error.flatten().fieldErrors };
  const profile = await requireProfile();
  const db = await createActionDatabaseClient();
  const { error } = await db.from("students").update({
    alias: parsed.data.alias,
    current_level: parsed.data.currentLevel || null,
    learning_goal: parsed.data.learningGoal || null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("owner_id", profile.id);
  if (error) return { message: "\u5b66\u751f\u60c5\u5831\u3092\u66f4\u65b0\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002" };
  revalidatePath(`/students/${id}`);
  return { message: "\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002" };
}

export async function deactivateStudent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const profile = await requireProfile();
  const db = await createActionDatabaseClient();
  const { error } = await db.from("students").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_id", profile.id);
  if (error) throw new Error("student_deactivate_failed");
  redirect("/students");
}
