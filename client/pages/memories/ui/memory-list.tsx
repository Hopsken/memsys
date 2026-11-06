import { Link, useLocation } from "react-router";

import { MemoryLength } from "@/entities/memory";
import { Byline } from "@/entities/persona";
import { TaggedText } from "@/features/tag-filter";
import type { Author, ListedFragment } from "@/shared/api";
import { listCardLink } from "@/shared/ui/list-card";
import { memoryId, useOpenHistory } from "@/widgets/memory-history";
import { formatRelativeDate, formatRelativeDateInline } from "@lib/date";

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// The shape of a typical list, measured into a skeleton while the real one
// loads: five rows, their lines running from one to three as a memory's text
// does.
export const SAMPLE_MEMORIES: ListedFragment[] = [
  {
    at: minutesAgo(7),
    by: "agent:Claude",
    fragment:
      "Prefers TypeScript with strict mode on, and no implicit any anywhere.",
    ref: "m_7qk3pR9x",
    versions: 1,
  },
  {
    at: minutesAgo(96),
    by: "agent:Claude",
    fragment:
      "Runs the test suite before changing code, then reads the failing case and keeps the diff small enough to review in one pass.",
    ref: "m_2vb8Nd4t",
    versions: 3,
  },
  {
    at: minutesAgo(420),
    by: "user",
    fragment: "Lives in Singapore, so examples use Asia/Singapore dates.",
    ref: "m_9wf1Xc6z",
    versions: 1,
  },
  {
    at: minutesAgo(1580),
    by: null,
    fragment: "Writes commit messages in the imperative mood.",
    ref: "m_6kt4Jz7p",
    versions: 1,
  },
  {
    at: minutesAgo(2860),
    by: "agent:Claude",
    fragment:
      "Answers in Chinese when asked in Chinese, and in Simplified Technical English otherwise.",
    ref: "m_3ry8Uh5b",
    versions: 2,
  },
];

// A row only shows the memory; clicking it opens the history, where it can be
// restored or forgotten. The history keeps the list's filter in its URL, so
// closing it returns to the same list.
const MemoryRow = ({
  item,
  onSelectAuthor,
}: {
  item: ListedFragment;
  onSelectAuthor?: ((by: Author) => void) | undefined;
}) => {
  const open = useOpenHistory();
  const to = `${item.ref}${useLocation().search}`;
  return (
    <li>
      <div className={listCardLink} onClick={open(to)}>
        <div className="text-muted-foreground flex min-h-7 flex-wrap items-center justify-between gap-x-4 text-xs">
          <span className="flex flex-wrap items-center gap-x-1.5">
            {item.by === null ? null : (
              <>
                <Byline
                  by={item.by}
                  withBy={false}
                  {...(onSelectAuthor && { onSelect: onSelectAuthor })}
                />
                <span aria-hidden="true">·</span>
              </>
            )}
            <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>
              {item.versions > 1
                ? `Edited ${formatRelativeDateInline(item.at)}`
                : formatRelativeDate(item.at)}
            </time>
          </span>
          <span className="flex items-center gap-3">
            <MemoryLength text={item.fragment} />
            <Link
              className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm font-mono outline-none focus-visible:ring-3"
              id={memoryId(item.ref)}
              to={to}
            >
              {item.ref}
            </Link>
          </span>
        </div>
        <p className="text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
          <TaggedText text={item.fragment} />
        </p>
      </div>
    </li>
  );
};

export const MemoryList = ({
  items,
  onSelectAuthor,
}: {
  items: ListedFragment[];
  onSelectAuthor?: ((by: Author) => void) | undefined;
}) => (
  <ul className="space-y-2">
    {items.map((item) => (
      <MemoryRow item={item} key={item.ref} onSelectAuthor={onSelectAuthor} />
    ))}
  </ul>
);
