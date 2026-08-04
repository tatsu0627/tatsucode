import type { SelectHTMLAttributes } from "react";

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-950 shadow-sm ${className}`} {...props} />;
}
