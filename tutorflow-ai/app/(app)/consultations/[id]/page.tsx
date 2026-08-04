import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { formatDate } from "@/lib/utils/format";
import { updateConsultationNotes } from "../actions";

export const dynamic = "force-dynamic";

export default async function ConsultationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDatabaseClient();
  const consultationResult = await db.from("consultations").select("*").eq("id", id).maybeSingle();
  if (!consultationResult.data) notFound();
  const consultation = consultationResult.data;
  const [studentResult, conceptResult, probeResult] = await Promise.all([db.from("students").select("alias").eq("id", consultation.student_id).maybeSingle(), db.from("concepts").select("id,label,code"), db.from("probes").select("*").eq("consultation_id", id).order("step")]);
  const concepts = new Map((conceptResult.data ?? []).map((concept) => [concept.id, concept]));
  const probes = probeResult.data ?? [];
  const save = updateConsultationNotes.bind(null, consultation.id);
  return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="text-sm font-semibold text-brand" href="/consultations">← 相談履歴</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">{consultation.topic}</h1><p className="mt-2 text-slate-600">{studentResult.data?.alias ?? "Alias"} / {formatDate(consultation.consultation_date)}</p></div>{!consultation.completed_at && consultation.target_concept_id ? <Link className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" href={`/diagnose?consultation=${consultation.id}`}>診断を再開</Link> : null}</div><div className="grid gap-5 md:grid-cols-2"><Card><h2 className="font-semibold">相談された概念</h2><p className="mt-3 text-lg">{consultation.target_concept_id ? concepts.get(consultation.target_concept_id)?.label ?? "Concept" : "旧セッションから移行"}</p></Card><Card className={consultation.root_blocker_concept_id ? "border-brand bg-brand-soft" : ""}><h2 className="font-semibold">Root blocker</h2><p className="mt-3 text-lg">{consultation.root_blocker_concept_id ? concepts.get(consultation.root_blocker_concept_id)?.label ?? "Concept" : "未確定"}</p></Card></div><section><h2 className="mb-3 text-xl font-semibold">確認履歴</h2>{probes.length ? <div className="space-y-3">{probes.map((probe) => <Card key={probe.id}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">Step {probe.step}: {concepts.get(probe.concept_id)?.label ?? "Concept"}</p><Link className="mt-1 inline-block text-sm font-semibold text-brand" href={`/materials/${probe.material_id}`}>確認済みプローブを開く</Link></div><span className={`rounded-full px-3 py-1 text-sm font-semibold ${probe.result === "solved" ? "bg-emerald-100 text-emerald-800" : probe.result === "failed" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{probe.result}</span></div></Card>)}</div> : <Card><p className="text-sm text-slate-500">まだ確認結果はありません。</p></Card>}</section><Card><h2 className="text-xl font-semibold">チューターメモ</h2><form action={save} className="mt-4 space-y-4"><div><label className="mb-1 block text-sm font-medium" htmlFor="summary">まとめ</label><textarea className="min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2.5" defaultValue={consultation.summary} id="summary" name="summary" maxLength={2000} /></div><div><label className="mb-1 block text-sm font-medium" htmlFor="privateNotes">自分専用メモ</label><textarea className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2.5" defaultValue={consultation.private_notes ?? ""} id="privateNotes" name="privateNotes" maxLength={2000} /></div><button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold" type="submit">メモを保存</button></form></Card></div>;
}
