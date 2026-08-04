"use client";

import { useState } from "react";
import type { MaterialDraft } from "@/lib/validation/ai-output";
import { HintDisclosure } from "./HintDisclosure";
import { Button } from "./ui/Button";

export function SessionRunner({ draft }: { draft: MaterialDraft }) {
  const [index, setIndex] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const problem = draft.problems[index];
  if (!problem) return null;
  function move(next: number) { setIndex(next); setShowSolution(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <div className="mx-auto max-w-4xl"><header className="flex items-center justify-between border-b border-slate-200 pb-5"><div><p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">Session mode</p><h1 className="mt-2 text-2xl font-semibold">{draft.topic}</h1></div><p className="rounded-full bg-slate-100 px-4 py-2 font-semibold">{index + 1} / {draft.problems.length}</p></header><main className="py-8"><p className="text-2xl font-medium leading-10 sm:text-3xl sm:leading-[1.5]">{problem.question}</p><HintDisclosure key={`hint-${index}`} hints={problem.hints} /><section className="mt-10 border-t border-slate-200 pt-8"><Button variant="secondary" type="button" onClick={() => setShowSolution((value) => !value)}>{showSolution ? "\u89e3\u7b54\u3092\u9589\u3058\u308b" : "\u89e3\u7b54\u624b\u9806\u3092\u8868\u793a"}</Button>{showSolution ? <div className="mt-4 rounded-2xl bg-brand-soft p-5"><h2 className="text-xl font-semibold text-brand">Solution steps</h2><ol className="mt-4 list-decimal space-y-3 pl-6 text-xl leading-9">{problem.solution_steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol>{problem.common_mistakes.length ? <div className="mt-7 border-t border-brand/15 pt-5"><h3 className="font-semibold text-brand">Common mistakes</h3><ul className="mt-3 list-disc space-y-2 pl-6 text-lg leading-8">{problem.common_mistakes.map((mistake, mistakeIndex) => <li key={mistakeIndex}>{mistake}</li>)}</ul></div> : null}</div> : null}</section></main><footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-slate-200 bg-white/95 py-5 backdrop-blur"><Button variant="secondary" disabled={index === 0} onClick={() => move(index - 1)} type="button">{"\u524d\u306e\u554f\u984c"}</Button><span className="font-semibold">{index + 1} / {draft.problems.length}</span><Button disabled={index === draft.problems.length - 1} onClick={() => move(index + 1)} type="button">{"\u6b21\u306e\u554f\u984c"}</Button></footer></div>;
}
