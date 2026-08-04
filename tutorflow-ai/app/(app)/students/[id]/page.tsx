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
  const [studentResult, sessionResult, materialResult] = await Promise.all([
    db.from("students").select("*").eq("id", id).eq("active", true).maybeSingle(),
    db.from("sessions").select("*").eq("student_id", id).order("session_date", { ascending: false }),
    db.from("materials").select("*").eq("student_id", id).order("created_at", { ascending: false }),
  ]);
  if (!studentResult.data) notFound();
  const student = studentResult.data;
  const sessions = sessionResult.data ?? [];
  const materials = materialResult.data ?? [];
  const trend = sessions.slice(0, 5).reverse();
  return <div className="space-y-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="text-sm font-semibold text-brand" href="/students">{"\u2190 \u5b66\u751f\u4e00\u89a7"}</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">{student.alias}</h1><p className="mt-2 text-slate-600">{student.current_level || "\u30ec\u30d9\u30eb\u672a\u8a2d\u5b9a"}</p></div><div className="flex gap-2"><Link className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold" href={`/sessions/new?studentId=${student.id}`}>{"\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332"}</Link><Link className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" href={`/materials/new?studentId=${student.id}`}>{"\u6559\u6750\u3092\u4f5c\u308b"}</Link></div></div>
    <div className="grid gap-6 lg:grid-cols-2"><Card><h2 className="text-lg font-semibold">{"\u5b66\u7fd2\u76ee\u6a19"}</h2><p className="mt-3 leading-7 text-slate-700">{student.learning_goal || "\u672a\u8a2d\u5b9a"}</p></Card><Card><h2 className="text-lg font-semibold">{"\u7406\u89e3\u5ea6\u306e\u63a8\u79fb\uff08\u76f4\u8fd15\u4ef6\uff09"}</h2>{trend.length ? <div className="mt-4 flex items-end gap-3">{trend.map((session) => <div className="flex flex-1 flex-col items-center gap-2" key={session.id}><span className="text-sm font-semibold">{session.understanding}</span><div className="w-full rounded-t-lg bg-brand" style={{ height: `${session.understanding * 16}px` }} /><span className="text-xs text-slate-500">{session.session_date.slice(5)}</span></div>)}</div> : <p className="mt-3 text-sm text-slate-500">{"\u307e\u3060\u8a18\u9332\u304c\u3042\u308a\u307e\u305b\u3093\u3002"}</p>}</Card></div>
    <div className="grid gap-6 lg:grid-cols-2"><section><h2 className="mb-3 text-xl font-semibold">{"\u30bb\u30c3\u30b7\u30e7\u30f3\u5c65\u6b74"}</h2>{sessions.length ? <div className="space-y-3">{sessions.map((session) => <Link href={`/sessions/${session.id}/edit`} key={session.id}><Card className="mb-3"><div className="flex justify-between gap-4"><div><p className="font-semibold">{session.topic}</p><p className="mt-1 text-sm text-slate-500">{formatDate(session.session_date)}</p><p className="mt-3 line-clamp-2 text-sm text-slate-700">{session.summary}</p></div><span className="h-fit rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">{session.understanding}/5</span></div></Card></Link>)}</div> : <Card><p className="text-sm text-slate-500">{"\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u304c\u3042\u308a\u307e\u305b\u3093\u3002"}</p></Card>}</section><section><h2 className="mb-3 text-xl font-semibold">{"\u6559\u6750"}</h2>{materials.length ? <div className="space-y-3">{materials.map((material) => <Link href={`/materials/${material.id}`} key={material.id}><Card className="mb-3"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">{material.topic}</p><p className="mt-1 text-sm text-slate-500">{material.difficulty}</p></div><StateBadge state={material.state} /></div></Card></Link>)}</div> : <Card><p className="text-sm text-slate-500">{"\u6559\u6750\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002"}</p></Card>}</section></div>
    <Card><h2 className="mb-5 text-xl font-semibold">{"\u5b66\u751f\u60c5\u5831\u3092\u7de8\u96c6"}</h2><StudentForm student={student} /><form action={deactivateStudent} className="mt-6 border-t border-slate-200 pt-6"><input type="hidden" name="id" value={student.id} /><button className="text-sm font-semibold text-red-700" type="submit">{"\u3053\u306e\u5b66\u751f\u3092\u975e\u8868\u793a\u306b\u3059\u308b"}</button></form></Card>
  </div>;
}
