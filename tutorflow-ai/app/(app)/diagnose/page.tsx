import Link from "next/link";
import { createServerDatabaseClient } from "@/lib/db/server";
import { buildDiagnosisGraph, diagnosticCandidates } from "@/lib/diagnosis/graph";
import { nextProbe, replayProbes, rootBlocker } from "@/lib/diagnosis/engine";
import { materialDraftSchema } from "@/lib/validation/ai-output";
import { todayIso } from "@/lib/utils/format";
import { DiagnosisWorkbench } from "@/components/DiagnosisWorkbench";
import { Card } from "@/components/ui/Card";
import { completeConsultation, startConsultation } from "../consultations/actions";

export const dynamic = "force-dynamic";

export default async function DiagnosePage({ searchParams }: { searchParams: Promise<{ consultation?: string }> }) {
  const { consultation: consultationId } = await searchParams;
  const db = await createServerDatabaseClient();
  const [studentResult, conceptResult, edgeResult] = await Promise.all([
    db.from("students").select("*").eq("active", true).order("alias"),
    db.from("concepts").select("*").order("depth").order("code"),
    db.from("concept_edges").select("prerequisite_id,dependent_id"),
  ]);
  const students = studentResult.data ?? [];
  const concepts = conceptResult.data ?? [];
  const edges = edgeResult.data ?? [];
  if (!consultationId) return <div className="mx-auto max-w-3xl space-y-6"><div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Drop-in diagnosis</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">前提概念からつまずきを診断する</h1><p className="mt-2 leading-7 text-slate-600">相談された概念から前提をたどり、確認済みの短い問題だけを学生に提示します。</p></div><Card>{students.length && concepts.length ? <form action={startConsultation} className="space-y-5"><div><label className="mb-1.5 block text-sm font-medium" htmlFor="studentId">学生</label><select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="studentId" name="studentId" required>{students.map((student) => <option key={student.id} value={student.id}>{student.alias}</option>)}</select></div><div><label className="mb-1.5 block text-sm font-medium" htmlFor="targetConceptId">相談された概念</label><select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="targetConceptId" name="targetConceptId" required>{[...concepts].sort((left, right) => right.depth - left.depth || left.code.localeCompare(right.code)).map((concept) => <option key={concept.id} value={concept.id}>{concept.label} (depth {concept.depth})</option>)}</select></div><input name="consultationDate" type="hidden" value={todayIso()} /><div><label className="mb-1.5 block text-sm font-medium" htmlFor="topic">相談テーマ</label><input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="topic" name="topic" defaultValue="Drop-in diagnosis" maxLength={120} required /></div><div><label className="mb-1.5 block text-sm font-medium" htmlFor="summary">初期メモ（任意）</label><textarea className="min-h-24 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="summary" name="summary" maxLength={2000} /></div><div><label className="mb-1.5 block text-sm font-medium" htmlFor="privateNotes">自分専用メモ（任意）</label><textarea className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="privateNotes" name="privateNotes" maxLength={2000} /></div><button className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" type="submit">診断を開始</button></form> : <p className="text-sm text-slate-600">学生と概念グラフを準備してから診断を開始してください。</p>}</Card></div>;

  const consultationResult = await db.from("consultations").select("*").eq("id", consultationId).maybeSingle();
  const consultation = consultationResult.data;
  if (!consultation) return <Card><p>相談記録が見つかりません。</p><Link className="mt-3 inline-block font-semibold text-brand" href="/diagnose">新しい診断を開始</Link></Card>;
  const student = students.find((item) => item.id === consultation.student_id);
  const target = concepts.find((item) => item.id === consultation.target_concept_id);
  if (!target) return <Card><h1 className="text-xl font-semibold">旧セッションから移行した相談記録</h1><p className="mt-2 text-slate-600">対象概念がないため診断は再開できません。履歴として相談詳細から確認できます。</p><Link className="mt-4 inline-block font-semibold text-brand" href={`/consultations/${consultation.id}`}>相談詳細を開く</Link></Card>;
  if (consultation.completed_at) return <Card><h1 className="text-xl font-semibold">診断は完了しています</h1><p className="mt-2 text-slate-600">{student?.alias ?? "Alias"} / {target.label}</p><Link className="mt-4 inline-block font-semibold text-brand" href={`/consultations/${consultation.id}`}>診断結果を開く</Link></Card>;

  const probesResult = await db.from("probes").select("*").eq("consultation_id", consultation.id).order("step");
  const probes = probesResult.data ?? [];
  const graph = buildDiagnosisGraph(concepts, edges);
  const state = replayProbes(graph, probes.map((probe) => ({ conceptId: probe.concept_id, result: probe.result })));
  const candidates = diagnosticCandidates(graph, target.id);
  const blockerId = rootBlocker(graph, state, graph.depthMap);
  const blocker = blockerId ? concepts.find((concept) => concept.id === blockerId) : null;
  if (blocker) {
    const finish = completeConsultation.bind(null, consultation.id, blocker.id);
    return <div className="mx-auto max-w-3xl space-y-6"><Card className="border-brand bg-brand-soft"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Root blocker found</p><h1 className="mt-2 text-3xl font-semibold">{blocker.label}</h1><p className="mt-3 leading-7 text-slate-700">直接の前提は解けていますが、この概念で失敗しました。ここから補強するのが最短です。</p><form action={finish} className="mt-5"><button className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" type="submit">この結果で診断を完了</button></form></Card><Link className="font-semibold text-brand" href={`/consultations/${consultation.id}`}>途中経過を確認</Link></div>;
  }
  const nextId = nextProbe(candidates, state, graph.depthMap);
  const nextConcept = concepts.find((concept) => concept.id === nextId);
  if (!nextConcept) return <Card><h1 className="text-xl font-semibold">追加の確認が必要です</h1><p className="mt-2 text-slate-600">候補を使い切りましたがroot blockerを特定できませんでした。対象概念とグラフを見直してください。</p></Card>;
  const [verifiedResult, unverifiedResult] = await Promise.all([
    db.from("materials").select("id,verified_content").eq("student_id", consultation.student_id).eq("concept_id", nextConcept.id).eq("kind", "probe").eq("state", "verified").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("materials").select("id").eq("student_id", consultation.student_id).eq("concept_id", nextConcept.id).eq("kind", "probe").eq("state", "unverified").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const parsedDraft = materialDraftSchema.safeParse(verifiedResult.data?.verified_content);
  const verifiedMaterial = verifiedResult.data && parsedDraft.success ? { id: verifiedResult.data.id, draft: parsedDraft.data } : null;
  return <div className="mx-auto max-w-4xl space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Diagnosis in progress</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{student?.alias ?? "Alias"}</h1><p className="mt-2 text-slate-600">Target: {target.label} / probe {probes.length + 1}</p></div><Link className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold" href={`/consultations/${consultation.id}`}>途中経過</Link></div><DiagnosisWorkbench consultationId={consultation.id} concept={{ id: nextConcept.id, code: nextConcept.code, label: nextConcept.label }} verifiedMaterial={verifiedMaterial} unverifiedMaterialId={unverifiedResult.data?.id ?? null} probeCount={probes.length} /></div>;
}
