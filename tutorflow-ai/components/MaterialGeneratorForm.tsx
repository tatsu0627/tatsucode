"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Student } from "@/lib/db/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Textarea } from "./ui/Textarea";

export function MaterialGeneratorForm({ students, goals, initialStudentId }: { students: Student[]; goals: Record<string, string>; initialStudentId?: string }) {
  const router = useRouter();
  const [studentId, setStudentId] = useState(initialStudentId ?? students[0]?.id ?? "");
  const [learningObjective, setLearningObjective] = useState(goals[initialStudentId ?? students[0]?.id ?? ""] ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch("/api/materials/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId, topic: form.get("topic"), difficulty: form.get("difficulty"), problemCount: Number(form.get("problemCount")), learningObjective }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.materialId) {
        setError(payload?.error?.message ?? "\u6559\u6750\u3092\u751f\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u6642\u9593\u3092\u304a\u3044\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
        return;
      }
      router.push(`/materials/${payload.materialId}`);
    } catch (error) {
      setError(error instanceof DOMException && error.name === "AbortError" ? "\u751f\u6210\u306b\u6642\u9593\u304c\u304b\u304b\u308a\u3059\u304e\u305f\u305f\u3081\u4e2d\u65ad\u3057\u307e\u3057\u305f\u3002\u554f\u984c\u6570\u3092\u6e1b\u3089\u3059\u304b\u3001\u6642\u9593\u3092\u304a\u3044\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002" : "\u901a\u4fe1\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u63a5\u7d9a\u3092\u78ba\u8a8d\u3057\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
    } finally {
      clearTimeout(timer);
      setPending(false);
    }
  }

  return <form className="space-y-6" onSubmit={submit}>
    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button className="mt-2 font-semibold underline" type="submit">{"\u518d\u8a66\u884c"}</button></div> : null}
    <div><label className="mb-1.5 block text-sm font-medium" htmlFor="studentId">{"\u5b66\u751f"}</label><Select id="studentId" value={studentId} onChange={(event) => { const id = event.target.value; setStudentId(id); setLearningObjective(goals[id] ?? ""); }}>{students.map((student) => <option key={student.id} value={student.id}>{student.alias}</option>)}</Select></div>
    <div><label className="mb-1.5 block text-sm font-medium" htmlFor="topic">{"\u5206\u91ce"}</label><Input id="topic" name="topic" required maxLength={100} placeholder="Quadratic equations" /></div>
    <div className="grid gap-5 sm:grid-cols-2"><div><label className="mb-1.5 block text-sm font-medium" htmlFor="difficulty">{"\u96e3\u6613\u5ea6"}</label><Select id="difficulty" name="difficulty" defaultValue="standard"><option value="introductory">Introductory</option><option value="standard">Standard</option><option value="advanced">Advanced</option></Select></div><div><label className="mb-1.5 block text-sm font-medium" htmlFor="problemCount">{"\u554f\u984c\u6570"}</label><Select id="problemCount" name="problemCount" defaultValue="3">{[1,2,3,4,5].map((count) => <option value={count} key={count}>{count}</option>)}</Select></div></div>
    <div><label className="mb-1.5 block text-sm font-medium" htmlFor="learningObjective">{"\u5b66\u7fd2\u76ee\u6a19"}</label><Textarea id="learningObjective" value={learningObjective} onChange={(event) => setLearningObjective(event.target.value)} minLength={5} maxLength={300} required /><p className="mt-1.5 text-xs text-slate-500">{"\u5b66\u751f\u306e\u767b\u9332\u6e08\u307f\u5b66\u7fd2\u76ee\u6a19\u3092\u81ea\u52d5\u5165\u529b\u3057\u307e\u3059\u3002\u7de8\u96c6\u3067\u304d\u307e\u3059\u3002"}</p></div>
    {pending ? <p className="rounded-xl bg-brand-soft p-3 text-sm text-brand">{"\u751f\u6210\u306b\u306f30\u79d2\u307b\u3069\u304b\u304b\u308a\u307e\u3059\u3002\u3053\u306e\u30da\u30fc\u30b8\u3092\u9589\u3058\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002"}</p> : null}
    <Button disabled={pending} type="submit">{pending ? "Generating..." : "AI\u306b\u4e0b\u66f8\u304d\u3092\u4f5c\u3063\u3066\u3082\u3089\u3046"}</Button>
  </form>;
}
