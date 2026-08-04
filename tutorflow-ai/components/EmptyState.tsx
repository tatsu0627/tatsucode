import Link from "next/link";
import { Card } from "./ui/Card";

export function EmptyState({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <Card className="border-dashed py-10 text-center"><h2 className="font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>{href && action ? <Link className="mt-5 inline-flex rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white" href={href}>{action}</Link> : null}</Card>;
}
