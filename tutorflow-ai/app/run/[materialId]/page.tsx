import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/guards";
import { createServerDatabaseClient } from "@/lib/db/server";
import { materialDraftSchema } from "@/lib/validation/ai-output";
import { SessionRunner } from "@/components/SessionRunner";

export const dynamic = "force-dynamic";

export default async function RunMaterialPage({ params }: { params: Promise<{ materialId: string }> }) {
  await requireProfile();
  const { materialId } = await params;
  const db = await createServerDatabaseClient();
  const { data } = await db.from("materials").select("state,verified_content").eq("id", materialId).maybeSingle();
  if (!data || data.state !== "verified" || !data.verified_content) notFound();
  const parsed = materialDraftSchema.safeParse(data.verified_content);
  if (!parsed.success) notFound();
  return <SessionRunner draft={parsed.data} />;
}
