"use client";

import { useState, useTransition } from "react";
import type { Material } from "@/lib/db/types";
import type { MaterialDraft } from "@/lib/validation/ai-output";
import { MaterialDiff } from "./MaterialDiff";
import { VerifyChecklist, VERIFY_ITEMS } from "./VerifyChecklist";
import { AiDraftWarning } from "./AiDraftWarning";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Textarea";
import { discardMaterial, saveMaterialEdit, verifyMaterial } from "@/app/(app)/materials/actions";

export function MaterialReview({ material, original, initialEdited }: { material: Material; original: MaterialDraft; initialEdited: MaterialDraft }) {
  const [edited, setEdited] = useState(initialEdited);
  const [checks, setChecks] = useState<boolean[]>(() => VERIFY_ITEMS.map(() => false));
  const [pane, setPane] = useState<"original" | "edited">("edited");
  const [reason, setReason] = useState(material.discard_reason ?? "");
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const readOnly = material.state !== "unverified";
  const allChecked = checks.every(Boolean);
  const run = (operation: () => Promise<void>, success?: string) => startTransition(async () => { setMessage(undefined); try { await operation(); if (success) setMessage(success); } catch { setMessage("\u64cd\u4f5c\u3092\u5b8c\u4e86\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u5185\u5bb9\u3092\u78ba\u8a8d\u3057\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002"); } });
  return <div className="space-y-6">{material.state === "unverified" ? <AiDraftWarning /> : null}{message ? <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p> : null}{readOnly ? <div className="rounded-xl bg-brand-soft p-4 text-sm font-medium text-brand">{material.state === "verified" ? "\u78ba\u8a8d\u6e08\u307f\u306e\u6559\u6750\u3067\u3059\u3002\u7de8\u96c6\u306f\u3067\u304d\u307e\u305b\u3093\u3002" : "\u3053\u306e\u6559\u6750\u306f\u7834\u68c4\u3055\u308c\u307e\u3057\u305f\u3002"}</div> : null}<div className="flex rounded-xl bg-slate-100 p-1 md:hidden"><button className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${pane === "original" ? "bg-white shadow-sm" : ""}`} onClick={() => setPane("original")} type="button">AI original</button><button className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${pane === "edited" ? "bg-white shadow-sm" : ""}`} onClick={() => setPane("edited")} type="button">Tutor revision</button></div>{readOnly ? <ReadOnlyDraft draft={initialEdited} /> : <MaterialDiff original={original} edited={edited} onChange={setEdited} activePane={pane} />}{!readOnly ? <><div className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><VerifyChecklist checked={checks} onChange={setChecks} /></div><div><label className="mb-1.5 block text-sm font-medium" htmlFor="discardReason">{"\u7834\u68c4\u7406\u7531\uff08\u4efb\u610f\uff09"}</label><Textarea className="min-h-20" id="discardReason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></div><div className="flex flex-wrap justify-end gap-3"><Button variant="danger" disabled={pending} onClick={() => run(() => discardMaterial(material.id, reason))} type="button">{"\u7834\u68c4"}</Button><Button variant="secondary" disabled={pending} onClick={() => run(() => saveMaterialEdit(material.id, JSON.stringify(edited)), "\u4e0b\u66f8\u304d\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002")} type="button">{"\u4e0b\u66f8\u304d\u4fdd\u5b58"}</Button><Button disabled={pending || !allChecked} onClick={() => run(() => verifyMaterial(material.id, JSON.stringify(edited)))} type="button">{"\u78ba\u8a8d\u6e08\u307f\u306b\u3059\u308b"}</Button></div>{!allChecked ? <p className="text-right text-sm text-slate-500">{"7\u9805\u76ee\u3059\u3079\u3066\u306e\u78ba\u8a8d\u304c\u5fc5\u8981\u3067\u3059\u3002"}</p> : null}</> : null}</div>;
}

function ReadOnlyDraft({ draft }: { draft: MaterialDraft }) {
  return <div className="space-y-4">{draft.problems.map((problem, index) => <article className="rounded-2xl border border-slate-200 bg-white p-5" key={index}><h2 className="font-semibold">Problem {index + 1}</h2><p className="mt-3 whitespace-pre-wrap text-lg leading-8">{problem.question}</p>{([["Hints", problem.hints], ["Solution steps", problem.solution_steps], ["Common mistakes", problem.common_mistakes]] as const).map(([label, items]) => <div className="mt-5" key={label}><h3 className="text-sm font-semibold text-slate-600">{label}</h3><ol className="mt-2 list-decimal space-y-2 pl-5 leading-7">{items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol></div>)}</article>)}</div>;
}
