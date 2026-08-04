import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";
import { MaterialGeneratorForm } from "@/components/MaterialGeneratorForm";

export const dynamic = "force-dynamic";

export default async function NewMaterialPage({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const { studentId } = await searchParams;
  const db = await createServerDatabaseClient();
  const [studentResult, sessionResult] = await Promise.all([
    db.from("students").select("*").eq("active", true).order("alias"),
    db.from("sessions").select("student_id,next_goal,session_date").order("session_date", { ascending: false }),
  ]);
  const goals: Record<string, string> = {};
  for (const session of sessionResult.data ?? []) if (!goals[session.student_id] && session.next_goal) goals[session.student_id] = session.next_goal;
  return <div className="mx-auto max-w-3xl"><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">AI draft</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{"\u7df4\u7fd2\u6559\u6750\u3092\u4f5c\u308b"}</h1><p className="mt-2 max-w-2xl leading-7 text-slate-600">{"AI\u306f\u4e0b\u66f8\u304d\u3060\u3051\u3092\u4f5c\u308a\u307e\u3059\u3002\u751f\u6210\u5f8c\u306f\u5fc5\u305a\u672c\u4eba\u304c\u691c\u7b97\u3057\u3001\u78ba\u8a8d\u6e08\u307f\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002"}</p><div className="mt-6">{studentResult.data?.length ? <Card><MaterialGeneratorForm students={studentResult.data} goals={goals} initialStudentId={studentId} /></Card> : <EmptyState title="\u5148\u306b\u5b66\u751f\u3092\u8ffd\u52a0\u3057\u3066\u304f\u3060\u3055\u3044" description="\u6559\u6750\u306f\u5b66\u751f alias \u3068\u5b66\u7fd2\u76ee\u6a19\u306b\u7d10\u3065\u304d\u307e\u3059\u3002" href="/students" action="\u5b66\u751f\u3092\u8ffd\u52a0" />}</div></div>;
}
