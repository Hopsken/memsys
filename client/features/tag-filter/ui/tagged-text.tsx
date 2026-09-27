import { cn } from "cn";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { findAnchors } from "@lib/anchor";

import { filteredList, useTags } from "../lib/tags";

// A tag in the filter, in the text and in the filter bar alike. Opaque, so
// text scrolling under the header doesn't show through.
export const selectedTag =
  "bg-[color-mix(in_oklab,var(--background),var(--color-blue-500)_12%)] font-medium text-blue-700 hover:bg-[color-mix(in_oklab,var(--background),var(--color-blue-500)_24%)]";

// Memory text with its #tags as links. A tag adds itself to the list's
// filter, or takes itself out when already there. `start` and `end` render a
// slice, so a diff can link a tag that spans its parts.
export const TaggedText = ({
  end,
  start = 0,
  text,
}: {
  end?: number;
  start?: number;
  text: string;
}) => {
  const tags = useTags();
  const stop = end ?? text.length;
  const nodes: ReactNode[] = [];
  let at = start;
  for (const anchor of findAnchors(text)) {
    const from = Math.max(anchor.start, at);
    const to = Math.min(anchor.end, stop);
    if (from < to) {
      const active = tags.includes(anchor.name);
      nodes.push(
        text.slice(at, from),
        <Link
          className={cn(
            // Inside a diff's added text, a tag keeps the addition's color.
            "focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-3 [ins_&]:text-current",
            active
              ? cn(selectedTag, "px-1")
              : "text-muted-foreground hover:text-foreground decoration-foreground/30 underline-offset-4 hover:underline"
          )}
          key={from}
          title={active ? "Stop filtering by this tag" : "Filter by this tag"}
          to={filteredList(
            active
              ? tags.filter((tag) => tag !== anchor.name)
              : [...tags, anchor.name]
          )}
        >
          {text.slice(from, to)}
        </Link>
      );
      at = to;
    }
  }
  nodes.push(text.slice(at, stop));
  return <>{nodes}</>;
};
