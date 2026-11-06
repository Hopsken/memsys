import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { Activity, ArrowDown } from "lucide-react";
import { Link, Outlet } from "react-router";
import { Skeleton } from "skullet/react";

import { MemoryLength, OpBadge } from "@/entities/memory";
import { authorLabel, Byline, usePersonas } from "@/entities/persona";
import { SessionExpired } from "@/features/auth";
import { AuthorFilter, useAuthorParam } from "@/features/author-filter";
import { api, isExpired } from "@/shared/api";
import type { ActivityEntry, ActivityPage, Author } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { listCardLink } from "@/shared/ui/list-card";
import {
  MemoryText,
  memoryId,
  useOpenHistory,
  useReturnFocus,
} from "@/widgets/memory-history";
import { formatRelativeDate } from "@lib/date";

const linkClass =
  "text-foreground underline underline-offset-4 hover:text-foreground/80";

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// A record of each kind, so the skeleton spans a chip, a byline, a time and a
// memory that wraps.
const SAMPLE_ACTIVITY: ActivityEntry[] = [
  {
    at: minutesAgo(4),
    by: "agent:Claude",
    fragment:
      "Prefers TypeScript with strict mode on, and no implicit any anywhere.",
    op: "remember",
    previous: null,
    ref: "m_7qk3pR9x",
  },
  {
    at: minutesAgo(38),
    by: "agent:Claude",
    fragment:
      "Prefers TypeScript with strict mode on, and no implicit any anywhere in the repository.",
    op: "revise",
    previous: "Prefers TypeScript with strict mode on.",
    ref: "m_7qk3pR9x",
  },
  {
    at: minutesAgo(96),
    by: "user",
    fragment: null,
    op: "forget",
    previous: "Uses pnpm, never npm.",
    ref: "m_4hd2Ls8n",
  },
  {
    at: minutesAgo(140),
    by: "agent:Codex",
    fragment: "Uses pnpm, never npm.",
    op: "restore",
    previous: null,
    ref: "m_4hd2Ls8n",
  },
  {
    at: minutesAgo(265),
    by: "agent:Claude",
    fragment: "Lives in Singapore, so examples use Asia/Singapore dates.",
    op: "remember",
    previous: null,
    ref: "m_9wf1Xc6z",
  },
];

const time = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const byDay = (entries: ActivityEntry[]) => {
  const days: { day: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const day = new Date(entry.at).toDateString();
    const last = days.at(-1);
    if (last?.day === day) {
      last.entries.push(entry);
    } else {
      days.push({ day, entries: [entry] });
    }
  }
  return days;
};

const EntryText = ({ entry }: { entry: ActivityEntry }) => {
  if (entry.fragment === null) {
    return entry.previous === null ? null : (
      <MemoryText className="text-muted-foreground" text={entry.previous} />
    );
  }
  return <MemoryText before={entry.previous} text={entry.fragment} />;
};

const EntryRow = ({
  entry,
  onSelectAuthor,
}: {
  entry: ActivityEntry;
  onSelectAuthor: (by: Author) => void;
}) => {
  const open = useOpenHistory();
  const to = `${entry.ref}?${new URLSearchParams({ at: entry.at })}`;
  const text = entry.fragment ?? entry.previous;
  return (
    <li>
      <div className={listCardLink} onClick={open(to)}>
        <div className="text-muted-foreground flex min-h-7 flex-wrap items-center justify-between gap-x-4 text-xs">
          <span className="flex flex-wrap items-center gap-x-1.5">
            <OpBadge op={entry.op} />
            <Byline by={entry.by} onSelect={onSelectAuthor} />
            <span aria-hidden="true">·</span>
            <time
              dateTime={entry.at}
              title={new Date(entry.at).toLocaleString()}
            >
              {time(entry.at)}
            </time>
          </span>
          <span className="flex items-center gap-3">
            {text === null ? null : <MemoryLength text={text} />}
            <Link
              className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm font-mono outline-none focus-visible:ring-3"
              id={memoryId(entry.ref, entry.at)}
              to={to}
            >
              {entry.ref}
            </Link>
          </span>
        </div>
        <EntryText entry={entry} />
      </div>
    </li>
  );
};

export const ActivityView = () => {
  const [by, setBy] = useAuthorParam();
  const personas = usePersonas();
  const filteredName = by === null ? null : authorLabel(by, personas.data);
  const query = useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage>,
    (string | null)[],
    string | null
  >({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) =>
      parseResponse(
        api.activity.$get(
          { query: { by: by ?? undefined, cursor: pageParam ?? undefined } },
          { init: { signal } }
        )
      ),
    queryKey: ["activity", by],
  });
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];
  useReturnFocus();

  if (isExpired(query.error)) {
    return <SessionExpired />;
  }

  return (
    <>
      {query.isError ? (
        <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <AlertDescription className="text-foreground">
            Couldn’t load activity.
          </AlertDescription>
          <Button
            onClick={() => {
              void (query.isFetchNextPageError
                ? query.fetchNextPage()
                : query.refetch());
            }}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </Alert>
      ) : null}

      <AuthorFilter by={by} className="mb-1" onChange={setBy} />
      {by?.startsWith("persona:") ? (
        <p className="text-muted-foreground mt-2 mb-1 text-xs">
          Earlier changes from its apps show under the app’s name.
        </p>
      ) : null}

      <section aria-busy={query.isFetching} aria-label="Activity">
        <Skeleton
          data={query.isPending ? null : entries}
          id="activity"
          label="Loading activity"
          sample={SAMPLE_ACTIVITY}
        >
          {(loaded) =>
            byDay(loaded).map(({ day, entries: dayEntries }) => (
              <section className="pt-6 first:pt-1" key={day}>
                <h2 className="text-muted-foreground pb-2 text-xs font-medium">
                  {formatRelativeDate(dayEntries[0]?.at ?? day)}
                </h2>
                <ul className="space-y-2">
                  {dayEntries.map((entry) => (
                    <EntryRow
                      entry={entry}
                      key={`${entry.ref}-${entry.at}`}
                      onSelectAuthor={setBy}
                    />
                  ))}
                </ul>
              </section>
            ))
          }
        </Skeleton>
        {query.isSuccess && entries.length === 0 && by !== null ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            {filteredName?.name === "you"
              ? "You haven’t changed anything yet."
              : `No changes by ${filteredName?.name ?? "this agent"} yet.`}
          </p>
        ) : null}
        {query.isSuccess && entries.length === 0 && by === null ? (
          <div className="rounded-xl border border-dashed px-6 py-16 text-center">
            <Activity
              aria-hidden="true"
              className="text-muted-foreground mx-auto mb-4 size-6"
            />
            <h2 className="font-medium">No activity yet</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              When your AI saves or changes a memory, you’ll see it here.{" "}
              <Link className={linkClass} to="/settings/mcp">
                Connect an AI tool
              </Link>{" "}
              to get started, or{" "}
              <Link className={linkClass} to="/settings/data">
                import memories
              </Link>
              .
            </p>
          </div>
        ) : null}
      </section>
      {query.hasNextPage ? (
        <footer className="mt-4 flex justify-center">
          <Button
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
            variant="outline"
          >
            <ArrowDown aria-hidden="true" />
            Load more
          </Button>
        </footer>
      ) : null}
      <Outlet />
    </>
  );
};
