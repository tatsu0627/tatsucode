import Link from "next/link";
import { requireProfile } from "@/lib/auth/guards";
import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/EmptyState";
import { formatDate } from "@/lib/utils/format";
import { resetDemoData } from "../actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await requireProfile();
  const db = await createServerDatabaseClient();
  const [studentResult, consultationResult, materialResult] = await Promise.all([
    db.from("students").select("*").eq("active", true).order("updated_at", { ascending: false }),
    db.from("consultations").select("*").order("consultation_date", { ascending: false }).limit(5),
    db.from("materials").select("id,topic,created_at").eq("state", "unverified").order("created_at", { ascending: false }),
  ]);
  const students = studentResult.data ?? [];
  const consultations = consultationResult.data ?? [];
  const materials = materialResult.data ?? [];
  const aliases = new Map(students.map((student) => [student.id, student.alias]));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Tutor workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{"\u6388\u696d\u6e96\u5099\u306e\u5168\u4f53\u50cf"}</h1><p className="mt-2 text-slate-600">{"\u6b21\u306b\u78ba\u8a8d\u3059\u3079\u304d\u8a18\u9332\u3068\u6559\u6750\u3092\u307e\u3068\u3081\u3066\u3044\u307e\u3059\u3002"}</p></div>
        <div className="flex gap-2"><Link className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold" href="/consultations">{"\u76f8\u8ac7\u5c65\u6b74"}</Link><Link className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" href="/diagnose">{"\u8a3a\u65ad\u3092\u59cb\u3081\u308b"}</Link></div>
      </div>

      <Card className={materials.length ? "border-amber-200 bg-amber-50" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-medium text-slate-600">{"\u30ec\u30d3\u30e5\u30fc\u5f85\u3061\u306e\u6559\u6750"}</p><p className="mt-1 text-4xl font-semibold text-slate-950">{materials.length}</p></div>{materials[0] ? <Link className="rounded-xl bg-amber-800 px-4 py-2.5 font-semibold text-white" href={`/materials/${materials[0].id}`}>{"\u30ec\u30d3\u30e5\u30fc\u3092\u958b\u304f"}</Link> : <p className="text-sm text-slate-500">{"\u672a\u78ba\u8a8d\u306e\u6559\u6750\u306f\u3042\u308a\u307e\u305b\u3093\u3002"}</p>}</div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section><div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">{"\u62c5\u5f53\u5b66\u751f"}</h2><Link className="text-sm font-semibold text-brand" href="/students">{"\u3059\u3079\u3066\u898b\u308b"}</Link></div>{students.length ? <div className="space-y-3">{students.map((student) => <Link href={`/students/${student.id}`} key={student.id}><Card className="mb-3 transition hover:border-brand"><p className="font-semibold">{student.alias}</p><p className="mt-1 text-sm text-slate-500">{student.current_level || "\u30ec\u30d9\u30eb\u672a\u8a2d\u5b9a"}</p></Card></Link>)}</div> : <EmptyState title="\u5b66\u751f\u306f\u307e\u3060\u3044\u307e\u305b\u3093" description="\u6700\u521d\u306e alias \u3068\u5b66\u7fd2\u76ee\u6a19\u3092\u767b\u9332\u3057\u307e\u3057\u3087\u3046\u3002" href="/students" action="\u6700\u521d\u306e\u5b66\u751f\u3092\u8ffd\u52a0\u3059\u308b" />}</section>
        <section><h2 className="mb-3 text-xl font-semibold">{"\u76f4\u8fd1\u306e\u76f8\u8ac7"}</h2>{consultations.length ? <div className="space-y-3">{consultations.map((consultation) => <Link href={`/consultations/${consultation.id}`} key={consultation.id}><Card className="mb-3 transition hover:border-brand"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{consultation.topic}</p><p className="mt-1 text-sm text-slate-500">{aliases.get(consultation.student_id) ?? "Alias"} / {formatDate(consultation.consultation_date)}</p></div><span className="rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand">{consultation.completed_at ? "\u5b8c\u4e86" : "\u8a3a\u65ad\u4e2d"}</span></div></Card></Link>)}</div> : <EmptyState title="\u76f8\u8ac7\u8a18\u9332\u304c\u3042\u308a\u307e\u305b\u3093" description="\u5b66\u751f\u304c\u6301\u3061\u8fbc\u3093\u3060\u6982\u5ff5\u306e\u524d\u63d0\u3092\u305f\u3069\u3063\u3066\u8a3a\u65ad\u3057\u307e\u3059\u3002" href="/diagnose" action="\u8a3a\u65ad\u3092\u59cb\u3081\u308b" />}</section>
      </div>

      {profile.is_demo ? <Card className="border-slate-300"><h2 className="font-semibold">Demo workspace</h2><p className="mt-2 text-sm leading-6 text-slate-500">{"\u5909\u66f4\u3057\u305f\u67b6\u7a7a\u30c7\u30fc\u30bf\u3092\u521d\u671f\u72b6\u614b\u306b\u623b\u3057\u307e\u3059\u3002"}</p><form action={resetDemoData} className="mt-4"><button className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold" type="submit">{"\u30c7\u30e2\u30c7\u30fc\u30bf\u3092\u30ea\u30bb\u30c3\u30c8"}</button></form></Card> : null}
    </div>
  );
}
