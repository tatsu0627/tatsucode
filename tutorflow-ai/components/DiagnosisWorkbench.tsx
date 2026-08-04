"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MaterialDraft } from "@/lib/validation/ai-output";
import { recordProbeResult } from "@/app/(app)/consultations/actions";
import { HintDisclosure } from "./HintDisclosure";
import { ProbeGeneratorButton } from "./ProbeGeneratorButton";
import { Button } from "./ui/Button";

export function DiagnosisWorkbench({ consultationId, concept, verifiedMaterial, unverifiedMaterialId, probeCount }: {
  consultationId: string;
  concept: { id: string; code: string; label: string };
  verifiedMaterial: { id: string; draft: MaterialDraft } | null;
  unverifiedMaterialId: string | null;
  probeCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  function save(result: "solved" | "failed" | "skipped") {
    if (!verifiedMaterial) return;
    startTransition(async () => {
      setError(undefined);
      try { await recordProbeResult(consultationId, concept.id, verifiedMaterial.id, result); router.refresh(); }
      catch { setError("結果を保存できませんでした。確認済みの問題を使っているか確認してください。"); }
    });
  }
  const problem = verifiedMaterial?.draft.problems[0];
  return <div className="space-y-5">{probeCount > 5 ? <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 font-medium text-amber-900">絞り込みが進んでいません。対象概念または前提グラフを見直してください。</p> : null}<div className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Next probe</p><h2 className="mt-2 text-2xl font-semibold">{concept.label}</h2><p className="mt-1 text-sm text-slate-500">{concept.code}</p></div>{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}{problem && verifiedMaterial ? <section aria-label="学生表示" className="rounded-3xl border-2 border-brand bg-white p-6"><p className="text-sm font-semibold text-brand">学生表示（確認済みプローブのみ）</p><p className="mt-5 text-2xl font-medium leading-10">{problem.question}</p><HintDisclosure hints={problem.hints} /><div className="mt-8 flex flex-wrap gap-3 border-t border-slate-200 pt-5"><Button disabled={pending} onClick={() => save("solved")} type="button">解けた</Button><Button disabled={pending} variant="danger" onClick={() => save("failed")} type="button">解けなかった</Button><Button disabled={pending} variant="secondary" onClick={() => save("skipped")} type="button">スキップ</Button></div></section> : unverifiedMaterialId ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-900">レビュー待ちの確認問題があります</h2><p className="mt-2 text-sm leading-6 text-amber-800">未確認内容はここには表示しません。チューターが検算してから診断に戻ってください。</p><Link className="mt-4 inline-flex rounded-xl bg-amber-900 px-4 py-2.5 font-semibold text-white" href={`/materials/${unverifiedMaterialId}`}>レビュー画面を開く</Link></div> : <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">確認済みプローブがありません</h2><p className="mt-2 text-sm leading-6 text-slate-600">AI下書きを生成し、必ずレビュー画面で検算してください。</p><div className="mt-4"><ProbeGeneratorButton consultationId={consultationId} conceptId={concept.id} /></div></div>}</div>;
}
