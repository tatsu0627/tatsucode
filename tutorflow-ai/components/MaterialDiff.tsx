"use client";

import type { MaterialDraft, Problem } from "@/lib/validation/ai-output";
import { Badge } from "./ui/Badge";
import { ProblemEditor } from "./ProblemEditor";

function ReadProblem({ problem, index }: { problem: Problem; index: number }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-semibold">Problem {index + 1}</h3><p className="mt-3 whitespace-pre-wrap leading-7">{problem.question}</p>{([["Hints", problem.hints], ["Solution steps", problem.solution_steps], ["Common mistakes", problem.common_mistakes]] as const).map(([title, items]) => <div className="mt-4" key={title}><h4 className="text-sm font-semibold text-slate-600">{title} ({items.length})</h4><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700">{items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ol></div>)}</article>;
}

export function MaterialDiff({ original, edited, onChange, activePane }: { original: MaterialDraft; edited: MaterialDraft; onChange: (draft: MaterialDraft) => void; activePane: "original" | "edited" }) {
  return <div className="grid gap-5 md:grid-cols-2"><section className={activePane === "edited" ? "hidden md:block" : "block"}><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">AI original</h2><span className="text-xs text-slate-500">Read only</span></div><div className="space-y-4">{original.problems.map((problem, index) => <ReadProblem problem={problem} index={index} key={index} />)}</div></section><section className={activePane === "original" ? "hidden md:block" : "block"}><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Tutor revision</h2>{JSON.stringify(original) !== JSON.stringify(edited) ? <Badge className="bg-blue-100 text-blue-700">{"\u5909\u66f4\u6e08\u307f"}</Badge> : null}</div><div className="space-y-4">{edited.problems.map((problem, index) => <ProblemEditor problem={problem} index={index} key={index} onChange={(next) => { const problems = [...edited.problems]; problems[index] = next; onChange({ ...edited, problems }); }} />)}</div></section></div>;
}
