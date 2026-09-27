import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Activity, ArrowDown } from "lucide-react";
import { Link, Outlet } from "react-router";

import { byline, OpBadge } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { api, isExpired } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  MemoryText,
  memoryId,
  useOpenHistory,
  useReturnFocus,
} from "@/widgets/memory-history";
import type { ActivityEntry, ActivityPage } from "@contract/memory";
import { formatRelativeDate } from "@lib/date";

const linkClass =
  "text-foreground underline underline-offset-4 hover:text-foreground/80";

const time = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Consecutive entries of one local day, newest day first.
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

// What the record did to the memory: the new text, the edit, or the text
// that was forgotten, dimmed.
const EntryText = ({ entry }: { entry: ActivityEntry }) => {
  if (entry.fragment === null) {
    return entry.previous === null ? null : (
      <MemoryText className="text-muted-foreground" text={entry.previous} />
    );
  }
  return <MemoryText before={entry.previous} text={entry.fragment} />;
};

// A row opens the memory's history at this version, where it can be used
// again or restored.
const EntryRow = ({ entry }: { entry: ActivityEntry }) => {
  const open = useOpenHistory();
  const to = `${entry.ref}?${new URLSearchParams({ at: entry.at })}`;
  return (
    <li>
      <div
        className="hover:bg-foreground/5 -mx-3 my-1 cursor-pointer space-y-1 rounded-lg px-3 py-2.5 transition-colors"
        onClick={open(to)}
      >
        <div className="text-muted-foreground flex min-h-7 flex-wrap items-center justify-between gap-x-4 text-xs">
          <span className="flex flex-wrap items-center gap-x-1.5">
            <OpBadge op={entry.op} />
            {byline(entry.by)}
            <span aria-hidden="true">·</span>
            <time
              dateTime={entry.at}
              title={new Date(entry.at).toLocaleString()}
            >
              {time(entry.at)}
            </time>
          </span>
          <Link
            className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm font-mono outline-none focus-visible:ring-3"
            id={memoryId(entry.ref, entry.at)}
            to={to}
          >
            {entry.ref}
          </Link>
        </div>
        <EntryText entry={entry} />
      </div>
    </li>
  );
};

// Every change to every memory, newest first: what your AI, or you, saved,
// edited, forgot, and restored.
export const ActivityView = () => {
  const query = useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage>,
    string[],
    string | null
  >({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) =>
      api
        .get("/api/activity", {
          searchParams: pageParam ? { cursor: pageParam } : {},
          signal,
        })
        .json<ActivityPage>(),
    queryKey: ["activity"],
  });
  const days = byDay(query.data?.pages.flatMap((page) => page.entries) ?? []);
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

      <section aria-busy={query.isFetching} aria-label="Activity">
        {query.isPending ? (
          <div className="divide-y" role="status">
            <span className="sr-only">Loading activity</span>
            {[1, 2, 3].map((key) => (
              <div className="space-y-2 py-3.5" key={key}>
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}
        {query.isSuccess && days.length === 0 ? (
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
        {days.map(({ day, entries }) => (
          <section className="pt-6 first:pt-1" key={day}>
            <h2 className="text-muted-foreground pb-1 text-xs font-medium">
              {formatRelativeDate(entries[0]?.at ?? day)}
            </h2>
            <ul className="divide-y">
              {entries.map((entry) => (
                <EntryRow entry={entry} key={`${entry.ref}-${entry.at}`} />
              ))}
            </ul>
          </section>
        ))}
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
