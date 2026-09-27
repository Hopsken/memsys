import { cn } from "cn";

import type { Op } from "@contract/memory";

const LABELS = {
  forget: "Forgotten",
  remember: "New",
  restore: "Restored",
  revise: "Edited",
} satisfies Record<Op, string>;

// Every label is a chip, so a list of them scans as one column. New and
// Edited make up most of a log, so they take soft cool tints and the rare
// ones worth noticing keep stronger color. Red and green belong to the diff,
// blue to tags. Translucent, so a chip still shows on a hovered row.
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
