"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/guards";
import { createActionDatabaseClient } from "@/lib/db/action";
import type { ProbeResult } from "@/lib/db/types";
import { consultationInputSchema, probeResultInputSchema } from "@/lib/validation/consultation";

function consultationValues(formData: FormData) {
  return {
    studentId: String(formData.get("studentId") ?? ""),
    targetConceptId: String(formData.get("targetConceptId") ?? ""),
    consultationDate: String(formData.get("consultationDate") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    privateNotes: String(formData.get("privateNotes") ?? "") || undefined,
  };
}

export async function startConsultation(formData: FormData) {
  const parsed = consultationInputSchema.safeParse(consultationValues(formData));
  if (!parsed.success) throw new Error("invalid_consultation");
  await requireProfile();
  const db = await createActionDatabaseClient();
  const [student, concept] = await Promise.all([
    db.from("students").select("id").eq("id", parsed.data.studentId).eq("active", true).maybeSingle(),
    db.from("concepts").select("id,label").eq("id", parsed.data.targetConceptId).maybeSingle(),
  ]);
  if (!student.data || !concept.data) throw new Error("consultation_target_not_found");
  const { data, error } = await db.from("consultations").insert({
    student_id: parsed.data.studentId,
    target_concept_id: parsed.data.targetConceptId,
    consultation_date: parsed.data.consultationDate,
    topic: parsed.data.topic || `${concept.data.label} diagnosis`,
    summary: parsed.data.summary,
    private_notes: parsed.data.privateNotes || null,
  }).select("id").single();
  if (error || !data) throw new Error("consultation_create_failed");
  redirect(`/diagnose?consultation=${data.id}`);
}

export async function recordProbeResult(
  consultationId: string,
  conceptId: string,
  materialId: string,
  result: ProbeResult,
) {
  const parsed = probeResultInputSchema.safeParse({ consultationId, conceptId, materialId, result });
  if (!parsed.success) throw new Error("invalid_probe_result");
  await requireProfile();
  const db = await createActionDatabaseClient();
  const [consultation, material, lastProbe] = await Promise.all([
    db.from("consultations").select("id,student_id,completed_at").eq("id", consultationId).maybeSingle(),
    db.from("materials").select("id,student_id,concept_id,kind,state").eq("id", materialId).maybeSingle(),
    db.from("probes").select("step").eq("consultation_id", consultationId).order("step", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!consultation.data || consultation.data.completed_at) throw new Error("consultation_not_active");
  if (!material.data || material.data.student_id !== consultation.data.student_id || material.data.concept_id !== conceptId || material.data.kind !== "probe" || material.data.state !== "verified") {
    throw new Error("verified_probe_required");
  }
  const step = (lastProbe.data?.step ?? 0) + 1;
  const { error } = await db.from("probes").insert({
    consultation_id: consultationId,
    concept_id: conceptId,
    material_id: materialId,
    material_state: "verified",
    result,
    step,
  });
  if (error) throw new Error("probe_result_save_failed");
  revalidatePath("/diagnose");
  revalidatePath(`/consultations/${consultationId}`);
}

export async function completeConsultation(consultationId: string, rootBlockerConceptId: string) {
  await requireProfile();
  const db = await createActionDatabaseClient();
  const { error } = await db.from("consultations").update({
    root_blocker_concept_id: rootBlockerConceptId,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", consultationId).is("completed_at", null);
  if (error) throw new Error("consultation_complete_failed");
  revalidatePath("/consultations");
  revalidatePath(`/consultations/${consultationId}`);
  redirect(`/consultations/${consultationId}`);
}

export async function updateConsultationNotes(consultationId: string, formData: FormData) {
  const summary = String(formData.get("summary") ?? "").trim().slice(0, 2000);
  const privateNotes = String(formData.get("privateNotes") ?? "").trim().slice(0, 2000) || null;
  await requireProfile();
  const db = await createActionDatabaseClient();
  const { error } = await db.from("consultations").update({ summary, private_notes: privateNotes, updated_at: new Date().toISOString() }).eq("id", consultationId);
  if (error) throw new Error("consultation_update_failed");
  revalidatePath(`/consultations/${consultationId}`);
}
