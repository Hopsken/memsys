import { cn } from "cn";

import type { Op } from "@/shared/api";

const LABELS = {
  forget: "Forgotten",
  remember: "New",
  restore: "Restored",
  revise: "Edited",
} satisfies Record<Op, string>;

const BADGES = {
  forget: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  remember: "bg-teal-500/10 text-teal-800 dark:text-teal-300",
  restore: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  revise: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
} satisfies Record<Op, string>;

export const OpBadge = ({ op }: { op: Op }) => (
  <span className={cn("rounded-md px-1.5 py-0.5 font-medium", BADGES[op])}>
    {LABELS[op]}
  </span>
);
