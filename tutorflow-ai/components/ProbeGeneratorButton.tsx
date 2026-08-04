"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/Button";

export function ProbeGeneratorButton({ consultationId, conceptId }: { consultationId: string; conceptId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function generate() {
    setPending(true);
    setError(undefined);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch("/api/probes/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consultationId, conceptId }), signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.materialId) { setError(payload?.error?.message ?? "診断プローブを生成できませんでした。"); return; }
      router.push(`/materials/${payload.materialId}`);
    } catch (caught) {
      setError(caught instanceof DOMException && caught.name === "AbortError" ? "生成に時間がかかりすぎたため中断しました。" : "通信に失敗しました。接続を確認してください。");
    } finally {
      clearTimeout(timer);
      setPending(false);
    }
  }
  return <div>{error ? <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p> : null}<Button disabled={pending} onClick={generate} type="button">{pending ? "Generating..." : "確認問題を生成する"}</Button><p className="mt-2 text-xs text-slate-500">生成後はレビュー画面に移動します。検算して確認済みにするまで学生には表示されません。</p></div>;
}
