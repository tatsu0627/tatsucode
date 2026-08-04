import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`min-h-28 w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-950 shadow-sm placeholder:text-slate-400 ${className}`} {...props} />;
}
