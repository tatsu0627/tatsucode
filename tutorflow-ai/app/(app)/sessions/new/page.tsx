import { createServerDatabaseClient } from "@/lib/db/server";
import { SessionForm } from "@/components/SessionForm";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function NewSessionPage({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const { studentId } = await searchParams;
  const db = await createServerDatabaseClient();
  const [students, materials] = await Promise.all([
    db.from("students").select("*").eq("active", true).order("alias"),
    db.from("materials").select("*").eq("state", "verified").order("created_at", { ascending: false }),
  ]);
  return <div className="mx-auto max-w-3xl"><h1 className="text-3xl font-semibold tracking-tight">{"\u30bb\u30c3\u30b7\u30e7\u30f3\u3092\u8a18\u9332"}</h1><p className="mt-2 text-slate-600">{"\u6388\u696d\u5f8c\u306e\u7406\u89e3\u5ea6\u3068\u6b21\u56de\u76ee\u6a19\u3092\u6b8b\u3057\u307e\u3059\u3002"}</p><div className="mt-6">{students.data?.length ? <Card><SessionForm students={students.data} materials={materials.data ?? []} initialStudentId={studentId} /></Card> : <EmptyState title="\u5148\u306b\u5b66\u751f\u3092\u8ffd\u52a0\u3057\u3066\u304f\u3060\u3055\u3044" description="\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u306b\u306f\u5b66\u751f alias \u304c\u5fc5\u8981\u3067\u3059\u3002" href="/students" action="\u5b66\u751f\u3092\u8ffd\u52a0" />}</div></div>;
}
