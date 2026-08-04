import { notFound } from "next/navigation";
import { createServerDatabaseClient } from "@/lib/db/server";
import { SessionForm } from "@/components/SessionForm";
import { Card } from "@/components/ui/Card";
import { deleteSession } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDatabaseClient();
  const [sessionResult, studentResult, materialResult, attachedResult] = await Promise.all([
    db.from("sessions").select("*").eq("id", id).maybeSingle(),
    db.from("students").select("*").eq("active", true).order("alias"),
    db.from("materials").select("*").eq("state", "verified").order("created_at", { ascending: false }),
    db.from("materials").select("id").eq("session_id", id),
  ]);
  if (!sessionResult.data) notFound();
  return <div className="mx-auto max-w-3xl"><h1 className="text-3xl font-semibold tracking-tight">{"\u30bb\u30c3\u30b7\u30e7\u30f3\u8a18\u9332\u3092\u7de8\u96c6"}</h1><Card className="mt-6"><SessionForm students={studentResult.data ?? []} materials={materialResult.data ?? []} session={sessionResult.data} selectedMaterialIds={(attachedResult.data ?? []).map((item) => item.id)} /><form action={deleteSession} className="mt-8 border-t border-slate-200 pt-6"><input type="hidden" name="id" value={id} /><button className="text-sm font-semibold text-red-700" type="submit">{"\u3053\u306e\u8a18\u9332\u3092\u524a\u9664"}</button></form></Card></div>;
}
