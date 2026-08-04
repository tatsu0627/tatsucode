import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/StateBadge";
import { StudentForm } from "@/components/StudentForm";
import { formatDate } from "@/lib/utils/format";
import { deactivateStudent } from "../actions";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDatabaseClient();
  const [studentResult, consultationResult, materialResult] = await Promise.all([
    db.from("students").select("*").eq("id", id).eq("active", true).maybeSingle(),
    db.from("consultations").select("*").eq("student_id", id).order("consultation_date", { ascending: false }),
    db.from("materials").select("*").eq("student_id", id).order("created_at", { ascending: false }),
  ]);
  if (!studentResult.data) notFound();
  const student = studentResult.data;
  const consultations = consultationResult.data ?? [];
  const materials = materialResult.data ?? [];
  const activeCount = consultations.filter((consultation) => !consultation.completed_at).length;
  const completedCount = consultations.length - activeCount;
  return <div className="space-y-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="text-sm font-semibold text-brand" href="/students">← 学生一覧</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">{student.alias}</h1><p className="mt-2 text-slate-600">{student.current_level || "レベル未設定"}</p></div><div className="flex gap-2"><Link className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold" href="/consultations">相談履歴</Link><Link className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" href="/diagnose">診断を開始</Link></div></div><div className="grid gap-6 md:grid-cols-3"><Card><h2 className="text-lg font-semibold">学習目標</h2><p className="mt-3 leading-7 text-slate-700">{student.learning_goal || "未設定"}</p></Card><Card><p className="text-sm text-slate-500">診断中</p><p className="mt-2 text-4xl font-semibold">{activeCount}</p></Card><Card><p className="text-sm text-slate-500">完了した相談</p><p className="mt-2 text-4xl font-semibold">{completedCount}</p></Card></div><div className="grid gap-6 lg:grid-cols-2"><section><h2 className="mb-3 text-xl font-semibold">相談履歴</h2>{consultations.length ? <div className="space-y-3">{consultations.map((consultation) => <Link href={`/consultations/${consultation.id}`} key={consultation.id}><Card className="mb-3"><div className="flex justify-between gap-4"><div><p className="font-semibold">{consultation.topic}</p><p className="mt-1 text-sm text-slate-500">{formatDate(consultation.consultation_date)}</p><p className="mt-3 line-clamp-2 text-sm text-slate-700">{consultation.summary || "診断中"}</p></div><span className="h-fit rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">{consultation.completed_at ? "完了" : "診断中"}</span></div></Card></Link>)}</div> : <Card><p className="text-sm text-slate-500">相談記録がありません。</p></Card>}</section><section><h2 className="mb-3 text-xl font-semibold">教材</h2>{materials.length ? <div className="space-y-3">{materials.map((material) => <Link href={`/materials/${material.id}`} key={material.id}><Card className="mb-3"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">{material.topic}</p><p className="mt-1 text-sm text-slate-500">{material.kind === "probe" ? "診断プローブ" : "練習教材"} / {material.difficulty}</p></div><StateBadge state={material.state} /></div></Card></Link>)}</div> : <Card><p className="text-sm text-slate-500">教材はまだありません。</p></Card>}</section></div><Card><h2 className="mb-5 text-xl font-semibold">学生情報を編集</h2><StudentForm student={student} /><form action={deactivateStudent} className="mt-6 border-t border-slate-200 pt-6"><input type="hidden" name="id" value={student.id} /><button className="text-sm font-semibold text-red-700" type="submit">この学生を非表示にする</button></form></Card></div>;
}
