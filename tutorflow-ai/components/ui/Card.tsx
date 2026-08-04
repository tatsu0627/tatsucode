import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(23,63,53,0.05)] ${className}`} {...props} />;
}
