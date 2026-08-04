import Link from "next/link";
import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function ConsultationsPage() {
  const db = await createServerDatabaseClient();
  const [consultationResult, studentResult, conceptResult] = await Promise.all([db.from("consultations").select("*").order("consultation_date", { ascending: false }), db.from("students").select("id,alias"), db.from("concepts").select("id,label")]);
  const consultations = consultationResult.data ?? [];
  const aliases = new Map((studentResult.data ?? []).map((student) => [student.id, student.alias]));
  const labels = new Map((conceptResult.data ?? []).map((concept) => [concept.id, concept.label]));
  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Consultations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">相談履歴</h1><p className="mt-2 text-slate-600">診断の途中経過とroot blockerを保存しています。</p></div><Link className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" href="/diagnose">新しい診断</Link></div>{consultations.length ? <div className="grid gap-4 lg:grid-cols-2">{consultations.map((consultation) => <Link href={`/consultations/${consultation.id}`} key={consultation.id}><Card className="h-full transition hover:border-brand"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-slate-500">{aliases.get(consultation.student_id) ?? "Alias"} / {formatDate(consultation.consultation_date)}</p><h2 className="mt-2 text-lg font-semibold">{consultation.topic}</h2><p className="mt-1 text-sm text-slate-600">{consultation.target_concept_id ? labels.get(consultation.target_concept_id) ?? "Concept" : "Legacy consultation"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${consultation.completed_at ? "bg-brand-soft text-brand" : "bg-amber-100 text-amber-800"}`}>{consultation.completed_at ? "完了" : "診断中"}</span></div></Card></Link>)}</div> : <EmptyState title="相談記録がありません" description="学生が持ち込んだ概念から前提をたどる診断を開始できます。" href="/diagnose" action="最初の診断を開始" />}</div>;
}
