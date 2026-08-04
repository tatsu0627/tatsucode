"use client";

import { useActionState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";
import { createStudent, updateStudent, type StudentActionState } from "@/app/(app)/students/actions";
import type { Student } from "@/lib/db/types";

const initialState: StudentActionState = {};

export function StudentForm({ student }: { student?: Student }) {
  const action = student ? updateStudent.bind(null, student.id) : createStudent;
  const [state, formAction, pending] = useActionState(action, initialState);
  const error = (name: string) => state.fieldErrors?.[name]?.[0];
  return (
    <form action={formAction} className="space-y-5">
      {state.message ? <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{state.message}</p> : null}
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="alias">Alias *</label><Input id="alias" name="alias" defaultValue={student?.alias} aria-invalid={Boolean(error("alias"))} />{error("alias") ? <p className="mt-1 text-sm text-red-600">{error("alias")}</p> : null}</div>
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="currentLevel">{"\u73fe\u5728\u306e\u30ec\u30d9\u30eb"}</label><Input id="currentLevel" name="currentLevel" defaultValue={student?.current_level ?? ""} />{error("currentLevel") ? <p className="mt-1 text-sm text-red-600">{error("currentLevel")}</p> : null}</div>
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="learningGoal">{"\u5b66\u7fd2\u76ee\u6a19"}</label><Textarea id="learningGoal" name="learningGoal" defaultValue={student?.learning_goal ?? ""} />{error("learningGoal") ? <p className="mt-1 text-sm text-red-600">{error("learningGoal")}</p> : null}</div>
      <Button disabled={pending} type="submit">{pending ? "Saving..." : student ? "\u5909\u66f4\u3092\u4fdd\u5b58" : "\u5b66\u751f\u3092\u8ffd\u52a0"}</Button>
    </form>
  );
}
