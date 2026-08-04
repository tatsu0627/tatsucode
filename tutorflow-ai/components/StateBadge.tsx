import { Badge } from "./ui/Badge";
import type { MaterialState } from "@/lib/db/types";

const stateConfig = {
  unverified: { label: "\u672a\u78ba\u8a8d", style: "bg-amber-100 text-amber-800" },
  verified: { label: "\u78ba\u8a8d\u6e08\u307f", style: "bg-green-100 text-green-800" },
  discarded: { label: "\u7834\u68c4", style: "bg-slate-200 text-slate-700" },
} satisfies Record<MaterialState, { label: string; style: string }>;

export function StateBadge({ state }: { state: MaterialState }) {
  const config = stateConfig[state];
  return <Badge className={config.style}>{config.label}</Badge>;
}
