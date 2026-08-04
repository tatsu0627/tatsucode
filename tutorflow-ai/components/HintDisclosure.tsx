"use client";

import { useState } from "react";
import { Button } from "./ui/Button";

export function HintDisclosure({ hints }: { hints: string[] }) {
  const [visible, setVisible] = useState(0);
  return <section className="mt-8"><div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold">Hints</h2>{visible < hints.length ? <Button variant="secondary" type="button" onClick={() => setVisible((count) => Math.min(count + 1, hints.length))}>{visible ? "\u6b21\u306e\u30d2\u30f3\u30c8" : "\u30d2\u30f3\u30c8\u3092\u898b\u308b"}</Button> : null}</div>{visible ? <ol className="mt-4 space-y-3">{hints.slice(0, visible).map((hint, index) => <li className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-lg leading-8" key={index}><span className="mr-2 font-semibold text-amber-800">{index + 1}.</span>{hint}</li>)}</ol> : <p className="mt-3 text-base text-slate-500">{"\u307e\u3060\u30d2\u30f3\u30c8\u306f\u958b\u3044\u3066\u3044\u307e\u305b\u3093\u3002"}</p>}</section>;
}
