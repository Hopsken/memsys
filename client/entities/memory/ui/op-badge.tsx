import { cn } from "cn";

import type { Op } from "@contract/memory";

const LABELS = {
  forget: "Forgotten",
  remember: "New",
  restore: "Restored",
  revise: "Edited",
} satisfies Record<Op, string>;

// Every label is a chip, so a list of them scans as one column. Edited is
// the usual step, so it stays gray; the rest stand out. Red and green belong
// to the diff. Translucent, so a chip still shows on a hovered row.
const BADGES = {
  forget: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  remember: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  restore: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
  revise: "bg-foreground/8 text-foreground",
} satisfies Record<Op, string>;

export const OpBadge = ({ op }: { op: Op }) => (
  <span className={cn("rounded-md px-1.5 py-0.5 font-medium", BADGES[op])}>
    {LABELS[op]}
  </span>
);
