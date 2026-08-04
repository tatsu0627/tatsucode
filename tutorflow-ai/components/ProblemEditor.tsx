"use client";

import type { Problem } from "@/lib/validation/ai-output";
import { Textarea } from "./ui/Textarea";
import { Button } from "./ui/Button";

type ListKey = "hints" | "solution_steps" | "common_mistakes";

export function ProblemEditor({ problem, index, onChange }: { problem: Problem; index: number; onChange: (problem: Problem) => void }) {
  function changeList(key: ListKey, itemIndex: number, value: string) {
    const list = [...problem[key]];
    list[itemIndex] = value;
    onChange({ ...problem, [key]: list });
  }
  function add(key: ListKey) { onChange({ ...problem, [key]: [...problem[key], ""] }); }
  function remove(key: ListKey, itemIndex: number) { onChange({ ...problem, [key]: problem[key].filter((_, index) => index !== itemIndex) }); }
  const sections: Array<{ key: ListKey; label: string; max: number }> = [
    { key: "hints", label: "Hints", max: 4 },
    { key: "solution_steps", label: "Solution steps", max: 10 },
    { key: "common_mistakes", label: "Common mistakes", max: 5 },
  ];
  return <article className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Problem {index + 1}</h3><label className="mt-4 block text-sm font-medium" htmlFor={`question-${index}`}>Question</label><Textarea className="mt-1.5" id={`question-${index}`} value={problem.question} onChange={(event) => onChange({ ...problem, question: event.target.value })} />{sections.map(({ key, label, max }) => <div className="mt-5" key={key}><div className="flex items-center justify-between"><h4 className="text-sm font-semibold">{label}</h4>{problem[key].length < max ? <button className="text-sm font-semibold text-brand" onClick={() => add(key)} type="button">+ Add</button> : null}</div><div className="mt-2 space-y-2">{problem[key].map((value, itemIndex) => <div className="flex gap-2" key={`${key}-${itemIndex}`}><Textarea className="min-h-20" value={value} onChange={(event) => changeList(key, itemIndex, event.target.value)} aria-label={`${label} ${itemIndex + 1}`} />{problem[key].length > (key === "common_mistakes" ? 0 : 1) ? <Button className="h-fit px-3" variant="secondary" type="button" onClick={() => remove(key, itemIndex)} aria-label={`Remove ${label} ${itemIndex + 1}`}>-</Button> : null}</div>)}</div></div>)}</article>;
}
