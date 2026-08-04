import Link from "next/link";
import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { StudentForm } from "@/components/StudentForm";
import { EmptyState } from "@/components/EmptyState";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const db = await createServerDatabaseClient();
  const [studentResult, sessionResult] = await Promise.all([
    db.from("students").select("*").eq("active", true).order("alias"),
    db.from("sessions").select("student_id,session_date").order("session_date", { ascending: false }),
  ]);
  const students = studentResult.data ?? [];
  const lastDates = new Map<string, string>();
  for (const session of sessionResult.data ?? []) if (!lastDates.has(session.student_id)) lastDates.set(session.student_id, session.session_date);
  return <div className="grid gap-8 lg:grid-cols-[1fr_380px]"><section><h1 className="text-3xl font-semibold tracking-tight">{"\u62c5\u5f53\u5b66\u751f"}</h1><p className="mt-2 text-slate-600">{"\u5b9f\u904b\u7528\u3067\u306f\u5b9f\u540d\u3067\u306f\u306a\u304f alias \u3092\u4f7f\u3044\u307e\u3059\u3002"}</p>{students.length ? <div className="mt-6 space-y-3">{students.map((student) => <Link href={`/students/${student.id}`} key={student.id}><Card className="mb-3 transition hover:border-brand"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{student.alias}</h2><p className="mt-1 text-sm text-slate-500">{student.current_level || "\u30ec\u30d9\u30eb\u672a\u8a2d\u5b9a"}</p><p className="mt-3 text-sm text-slate-700">{student.learning_goal || "\u5b66\u7fd2\u76ee\u6a19\u672a\u8a2d\u5b9a"}</p></div><p className="text-sm text-slate-500">{"\u6700\u7d42"}: {formatDate(lastDates.get(student.id))}</p></div></Card></Link>)}</div> : <div className="mt-6"><EmptyState title="\u5b66\u751f\u304c\u3044\u307e\u305b\u3093" description="\u53f3\u306e\u30d5\u30a9\u30fc\u30e0\u304b\u3089\u6700\u521d\u306e\u5b66\u751f\u3092\u8ffd\u52a0\u3057\u3066\u304f\u3060\u3055\u3044\u3002" /></div>}</section><aside><Card><h2 className="mb-5 text-xl font-semibold">{"\u5b66\u751f\u3092\u8ffd\u52a0"}</h2><StudentForm /></Card></aside></div>;
}
