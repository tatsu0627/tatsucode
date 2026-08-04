"use client";

export const VERIFY_ITEMS = [
  "\u554f\u984c\u306f\u89e3\u3051\u308b\u304b",
  "\u89e3\u7b54\u306f\u6b63\u3057\u3044\u304b",
  "\u96e3\u6613\u5ea6\u306f\u5408\u3046\u304b",
  "\u30d2\u30f3\u30c8\u304c\u7b54\u3048\u3092\u660e\u304b\u3057\u3066\u3044\u306a\u3044\u304b",
  "\u8aac\u660e\u306b\u98db\u8e8d\u304c\u306a\u3044\u304b",
  "\u4e0d\u9069\u5207\u306a\u8868\u73fe\u304c\u306a\u3044\u304b",
  "\u500b\u4eba\u60c5\u5831\u304c\u6df7\u5165\u3057\u3066\u3044\u306a\u3044\u304b",
] as const;

export function VerifyChecklist({ checked, onChange }: { checked: boolean[]; onChange: (checked: boolean[]) => void }) {
  return <fieldset><legend className="text-lg font-semibold">{"\u691c\u7b97\u30c1\u30a7\u30c3\u30af\u30ea\u30b9\u30c8"}</legend><p className="mt-1 text-sm text-slate-500">{"7\u9805\u76ee\u3092\u81ea\u5206\u3067\u78ba\u8a8d\u3057\u3066\u304b\u3089\u78ba\u5b9a\u3057\u307e\u3059\u3002"}</p><div className="mt-4 grid gap-3 md:grid-cols-2">{VERIFY_ITEMS.map((item, index) => <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-6" key={item}><input className="mt-1 size-4" type="checkbox" checked={checked[index] ?? false} onChange={(event) => { const next = [...checked]; next[index] = event.target.checked; onChange(next); }} /><span>{item}</span></label>)}</div></fieldset>;
}
