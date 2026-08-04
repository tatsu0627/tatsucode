import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };

export function Button({ className = "", variant = "primary", ...props }: Props) {
  const variants = {
    primary: "bg-brand text-white hover:bg-[#0f3028]",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  };
  return <button className={`rounded-xl px-4 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`} {...props} />;
}
