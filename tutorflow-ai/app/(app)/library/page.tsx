import Link from "next/link";
import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/StateBadge";
import { EmptyState } from "@/components/EmptyState";
import { duplicateMaterial } from "../materials/actions";
import type { MaterialState } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ state?: string; student?: string; topic?: string }> }) {
  const filters = await searchParams;
  const state: MaterialState = ["unverified", "verified", "discarded"].includes(filters.state ?? "") ? filters.state as MaterialState : "verified";
  const db = await createServerDatabaseClient();
  const studentsResult = await db.from("students").select("id,alias").eq("active", true).order("alias");
  let query = db.from("materials").select("*").eq("state", state).order("created_at", { ascending: false });
  if (filters.student) query = query.eq("student_id", filters.student);
  if (filters.topic) query = query.ilike("topic", `%${filters.topic}%`);
  const materialResult = await query;
  const students = studentsResult.data ?? [];
  const aliases = new Map(students.map((student) => [student.id, student.alias]));
  return <div className="space-y-6"><div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Material library</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{"\u6559\u6750\u30e9\u30a4\u30d6\u30e9\u30ea"}</h1><p className="mt-2 text-slate-600">{"\u904e\u53bb\u306e\u5206\u91ce\u3092\u78ba\u8a8d\u3057\u3001\u91cd\u8907\u51fa\u984c\u3092\u9632\u304e\u307e\u3059\u3002"}</p></div><Card><form className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto]" method="get"><div><label className="mb-1 block text-sm font-medium" htmlFor="state">State</label><select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="state" name="state" defaultValue={state}><option value="verified">{"\u78ba\u8a8d\u6e08\u307f"}</option><option value="unverified">{"\u672a\u78ba\u8a8d"}</option><option value="discarded">{"\u7834\u68c4"}</option></select></div><div><label className="mb-1 block text-sm font-medium" htmlFor="student">{"\u5b66\u751f"}</label><select className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="student" name="student" defaultValue={filters.student ?? ""}><option value="">All</option>{students.map((student) => <option value={student.id} key={student.id}>{student.alias}</option>)}</select></div><div><label className="mb-1 block text-sm font-medium" htmlFor="topic">{"\u5206\u91ce"}</label><input className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" id="topic" name="topic" defaultValue={filters.topic ?? ""} /></div><button className="self-end rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" type="submit">{"\u7d5e\u308a\u8fbc\u3080"}</button></form></Card>{materialResult.data?.length ? <div className="grid gap-4 lg:grid-cols-2">{materialResult.data.map((material) => <Card key={material.id}><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-slate-500">{aliases.get(material.student_id) ?? "Alias"}</p><h2 className="mt-1 text-lg font-semibold">{material.topic}</h2><p className="mt-1 text-sm text-slate-500">{material.difficulty}</p></div><StateBadge state={material.state} /></div><div className="mt-5 flex flex-wrap gap-2">{material.state === "verified" ? <><Link className="rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white" href={`/run/${material.id}`}>{"\u30bb\u30c3\u30b7\u30e7\u30f3\u30e2\u30fc\u30c9"}</Link><form action={duplicateMaterial}><input type="hidden" name="materialId" value={material.id} /><button className="rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold" type="submit">{"\u8907\u88fd\u3057\u3066\u518d\u5229\u7528"}</button></form></> : <Link className="rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold" href={`/materials/${material.id}`}>{"\u6559\u6750\u3092\u958b\u304f"}</Link>}</div></Card>)}</div> : <EmptyState title="\u6761\u4ef6\u306b\u5408\u3046\u6559\u6750\u304c\u3042\u308a\u307e\u305b\u3093" description="\u30d5\u30a3\u30eb\u30bf\u3092\u5909\u3048\u308b\u304b\u3001\u65b0\u3057\u3044\u6559\u6750\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002" href="/materials/new" action="\u6559\u6750\u3092\u4f5c\u308b" />}</div>;
}
