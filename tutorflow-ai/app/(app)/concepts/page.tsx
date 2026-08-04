import { createServerDatabaseClient } from "@/lib/db/server";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function ConceptsPage() {
  const db = await createServerDatabaseClient();
  const [conceptResult, edgeResult] = await Promise.all([db.from("concepts").select("*").order("depth").order("code"), db.from("concept_edges").select("prerequisite_id,dependent_id")]);
  const concepts = conceptResult.data ?? [];
  const labels = new Map(concepts.map((concept) => [concept.id, concept.label]));
  const prerequisites = new Map<string, string[]>();
  for (const edge of edgeResult.data ?? []) prerequisites.set(edge.dependent_id, [...(prerequisites.get(edge.dependent_id) ?? []), labels.get(edge.prerequisite_id) ?? "Concept"]);
  return <div className="space-y-6"><div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Concept graph</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">診断概念</h1><p className="mt-2 text-slate-600">読み取り専用の18概念と前提関係です。</p></div><div className="grid gap-4 lg:grid-cols-2">{concepts.map((concept) => <Card key={concept.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-accent">{concept.code}</p><h2 className="mt-1 text-lg font-semibold">{concept.label}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">depth {concept.depth}</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{concept.description}</p><p className="mt-3 text-xs text-slate-500">Prerequisites: {(prerequisites.get(concept.id) ?? []).join(", ") || "None"}</p></Card>)}</div></div>;
}
