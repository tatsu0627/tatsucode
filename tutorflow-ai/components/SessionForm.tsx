"use client";

import { useActionState, useState } from "react";
import { createSession, updateSession, type SessionActionState } from "@/app/(app)/sessions/actions";
import type { Material, Session, Student } from "@/lib/db/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Textarea } from "./ui/Textarea";
import { todayIso } from "@/lib/utils/format";

const initialState: SessionActionState = {};

export function SessionForm({ students, materials, session, selectedMaterialIds = [], initialStudentId }: {
  students: Student[]; materials: Material[]; session?: Session; selectedMaterialIds?: string[]; initialStudentId?: string;
}) {
  const action = session ? updateSession.bind(null, session.id) : createSession;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [studentId, setStudentId] = useState(session?.student_id ?? initialStudentId ?? students[0]?.id ?? "");
  const error = (name: string) => state.fieldErrors?.[name]?.[0];
  const available = materials.filter((material) => material.student_id === studentId && material.state === "verified");
  return (
    <form action={formAction} className="space-y-6">
      {state.message ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.message}</p> : null}
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="studentId">{"\u5b66\u751f"} *</label><Select id="studentId" name="studentId" value={studentId} onChange={(event) => setStudentId(event.target.value)}>{students.map((student) => <option key={student.id} value={student.id}>{student.alias}</option>)}</Select>{error("studentId") ? <p className="mt-1 text-sm text-red-600">{error("studentId")}</p> : null}</div>
      <div className="grid gap-5 md:grid-cols-2">
        <div><label className="mb-1.5 block text-sm font-medium" htmlFor="sessionDate">{"\u65e5\u4ed8"} *</label><Input id="sessionDate" name="sessionDate" type="date" defaultValue={session?.session_date ?? todayIso()} />{error("sessionDate") ? <p className="mt-1 text-sm text-red-600">{error("sessionDate")}</p> : null}</div>
        <div><label className="mb-1.5 block text-sm font-medium" htmlFor="topic">{"\u5206\u91ce"} *</label><Input id="topic" name="topic" defaultValue={session?.topic} />{error("topic") ? <p className="mt-1 text-sm text-red-600">{error("topic")}</p> : null}</div>
      </div>
      <fieldset><legend className="mb-2 text-sm font-medium">{"\u7406\u89e3\u5ea6"} *</legend><div className="grid grid-cols-5 gap-2">{[1,2,3,4,5].map((value) => <label className="cursor-pointer" key={value}><input className="peer sr-only" type="radio" name="understanding" value={value} defaultChecked={(session?.understanding ?? 3) === value} /><span className="grid h-11 place-items-center rounded-xl border border-slate-300 bg-white font-semibold peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">{value}</span></label>)}</div>{error("understanding") ? <p className="mt-1 text-sm text-red-600">{error("understanding")}</p> : null}</fieldset>
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="summary">{"\u6388\u696d\u306e\u307e\u3068\u3081"} *</label><Textarea id="summary" name="summary" defaultValue={session?.summary} />{error("summary") ? <p className="mt-1 text-sm text-red-600">{error("summary")}</p> : null}</div>
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="difficultyNotes">{"\u3064\u307e\u305a\u3044\u305f\u70b9"}</label><Textarea id="difficultyNotes" name="difficultyNotes" defaultValue={session?.difficulty_notes ?? ""} /></div>
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="nextGoal">{"\u6b21\u56de\u306e\u76ee\u6a19"}</label><Textarea id="nextGoal" name="nextGoal" defaultValue={session?.next_goal ?? ""} /></div>
      <div><label className="mb-1.5 block text-sm font-medium" htmlFor="privateNotes">{"\u81ea\u5206\u5c02\u7528\u30e1\u30e2"}</label><Textarea id="privateNotes" name="privateNotes" defaultValue={session?.private_notes ?? ""} /></div>
      <fieldset><legend className="mb-2 text-sm font-medium">{"\u4f7f\u3063\u305f\u6559\u6750\uff08\u78ba\u8a8d\u6e08\u307f\u306e\u307f\uff09"}</legend>{available.length ? <div className="space-y-2">{available.map((material) => <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3" key={material.id}><input type="checkbox" name="usedMaterialIds" value={material.id} defaultChecked={selectedMaterialIds.includes(material.id)} /><span>{material.topic}</span></label>)}</div> : <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-500">{"\u9078\u629e\u3067\u304d\u308b\u78ba\u8a8d\u6e08\u307f\u6559\u6750\u306f\u3042\u308a\u307e\u305b\u3093\u3002"}</p>}</fieldset>
      <Button disabled={pending} type="submit">{pending ? "Saving..." : "\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u3092\u4fdd\u5b58"}</Button>
    </form>
  );
}
