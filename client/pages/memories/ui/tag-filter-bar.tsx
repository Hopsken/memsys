import { cn } from "cn";
import { XIcon } from "lucide-react";
import { Link } from "react-router";

import { filteredList, selectedTag, useTags } from "@/features/tag-filter";

// The tags filtering the list, heading it like a toolbar. It sticks under
// the app header, so on a long list it stays in reach; it is opaque, so the
// list scrolls cleanly under it. Like the header, it has no rule: the gap
// before the first card sets it apart.
export const TagFilterBar = () => {
  const tags = useTags();
  if (tags.length === 0) {
    return null;
  }
  return (
    <nav
      aria-label="Tag filter"
      className="bg-background sticky top-(--header-height) z-10 -mx-3 -mt-2 mb-1 px-3 pt-2"
    >
      <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {tags.map((tag) => (
          <Link
            aria-label={`Remove #${tag}`}
            className={cn(
              selectedTag,
              "focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1 rounded-md pr-1.5 pl-2 text-xs transition-colors outline-none focus-visible:ring-3"
            )}
            key={tag}
            to={filteredList(tags.filter((each) => each !== tag))}
          >
            #{tag}
            <XIcon aria-hidden="true" className="size-3.5 opacity-60" />
          </Link>
        ))}
        {tags.length > 1 ? (
          <Link
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-md px-1.5 text-xs outline-none focus-visible:ring-3"
            to={filteredList([])}
          >
            Clear
          </Link>
        ) : null}
      </div>
    </nav>
  );
};
