import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerDatabaseClient } from "@/lib/db/server";
import { materialDraftSchema } from "@/lib/validation/ai-output";
import { StateBadge } from "@/components/StateBadge";
import { MaterialReview } from "@/components/MaterialReview";
import { ErrorState } from "@/components/ErrorState";

export const dynamic = "force-dynamic";

export default async function MaterialReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDatabaseClient();
  const materialResult = await db.from("materials").select("*").eq("id", id).maybeSingle();
  if (!materialResult.data) notFound();
  const material = materialResult.data;
  const studentResult = await db.from("students").select("alias").eq("id", material.student_id).maybeSingle();
  const original = materialDraftSchema.safeParse(material.ai_draft);
  const edited = materialDraftSchema.safeParse(material.verified_content ?? material.ai_draft);
  return <div className="space-y-6"><Link className="text-sm font-semibold text-brand" href={`/students/${material.student_id}`}>{"\u2190 \u5b66\u751f\u8a73\u7d30"}</Link><header className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-3"><StateBadge state={material.state} /><span className="text-sm text-slate-500">{material.difficulty}</span></div><h1 className="mt-3 text-3xl font-semibold tracking-tight">{material.topic}</h1><p className="mt-2 text-slate-600">{studentResult.data?.alias ?? "Alias"}</p></div>{material.state === "verified" ? <Link className="rounded-xl bg-brand px-4 py-2.5 font-semibold text-white" href={`/run/${material.id}`}>{"\u30bb\u30c3\u30b7\u30e7\u30f3\u30e2\u30fc\u30c9\u3067\u958b\u304f"}</Link> : null}</header>{original.success && edited.success ? <MaterialReview material={material} original={original.data} initialEdited={edited.data} /> : <ErrorState message="\u6559\u6750\u30c7\u30fc\u30bf\u306e\u5f62\u5f0f\u3092\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002\u3053\u306e\u6559\u6750\u306f\u4f7f\u7528\u3057\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002" />}</div>;
}
