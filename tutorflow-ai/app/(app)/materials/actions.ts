"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/guards";
import { createActionDatabaseClient } from "@/lib/db/action";
import type { Json } from "@/lib/db/types";
import { materialDraftSchema } from "@/lib/validation/ai-output";
import { nextState } from "@/lib/validation/material";

async function ownedMaterial(id: string) {
  await requireProfile();
  const db = await createActionDatabaseClient();
  const { data } = await db.from("materials").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Error("material_not_found");
  return { db, material: data };
}

function parsedContent(contentJson: string) {
  let value: unknown;
  try { value = JSON.parse(contentJson); } catch { throw new Error("invalid_material_content"); }
  const parsed = materialDraftSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_material_content");
  return parsed.data;
}

export async function saveMaterialEdit(materialId: string, contentJson: string) {
  const { db, material } = await ownedMaterial(materialId);
  if (material.state !== "unverified") throw new Error("invalid_material_state");
  const content = parsedContent(contentJson);
  const { error } = await db.from("materials").update({ verified_content: content as Json, updated_at: new Date().toISOString() }).eq("id", materialId);
  if (error) throw new Error("material_save_failed");
  revalidatePath(`/materials/${materialId}`);
}

export async function verifyMaterial(materialId: string, contentJson: string) {
  const { db, material } = await ownedMaterial(materialId);
  if (material.state !== "unverified") throw new Error("invalid_material_state");
  nextState(material.state, "verified");
  const content = parsedContent(contentJson);
  const { error } = await db.from("materials").update({ state: "verified", verified_content: content as Json, verified_at: new Date().toISOString(), discard_reason: null, updated_at: new Date().toISOString() }).eq("id", materialId).eq("state", "unverified");
  if (error) throw new Error("material_verify_failed");
  revalidatePath(`/materials/${materialId}`);
  redirect(`/materials/${materialId}`);
}

export async function discardMaterial(materialId: string, reason: string) {
  const { db, material } = await ownedMaterial(materialId);
  if (material.state !== "unverified") throw new Error("invalid_material_state");
  nextState(material.state, "discarded");
  const normalized = reason.trim().slice(0, 500) || null;
  const { error } = await db.from("materials").update({ state: "discarded", discard_reason: normalized, session_id: null, updated_at: new Date().toISOString() }).eq("id", materialId).eq("state", "unverified");
  if (error) throw new Error("material_discard_failed");
  revalidatePath(`/materials/${materialId}`);
  redirect(`/materials/${materialId}`);
}

export async function duplicateMaterial(formData: FormData) {
  const materialId = String(formData.get("materialId") ?? "");
  const { db, material } = await ownedMaterial(materialId);
  if (material.state !== "verified" || !material.verified_content) throw new Error("verified_material_required");
  const { data, error } = await db.from("materials").insert({ student_id: material.student_id, topic: material.topic, difficulty: material.difficulty, state: "unverified", ai_draft: material.verified_content, verified_content: material.verified_content, prompt_version: material.prompt_version, model_label: material.model_label }).select("id").single();
  if (error || !data) throw new Error("material_duplicate_failed");
  redirect(`/materials/${data.id}`);
}
