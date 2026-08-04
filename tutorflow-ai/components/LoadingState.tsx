export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <div aria-live="polite" className="animate-pulse rounded-xl bg-slate-100 p-5 text-sm text-slate-500">{label}</div>;
}
