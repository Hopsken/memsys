import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { ArrowDown, Layers } from "lucide-react";
import { Link } from "react-router";

import { SessionExpired } from "@/components/session-expired";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isExpired } from "@/lib/api";

import type { Fragment, FragmentPage } from "../contract/memory";
import { formatRelativeDate } from "../lib/date";

const linkClass =
  "text-foreground underline underline-offset-4 hover:text-foreground/80";

// A fragment revised between page loads can appear twice; keep its latest copy.
const flatten = (pages: FragmentPage[]) => {
  const items = new Map<string, Fragment>();
  for (const item of pages.flatMap((page) => page.fragments)) {
    items.delete(item.ref);
    items.set(item.ref, item);
  }
  return [...items.values()];
};

export const FragmentsView = () => {
  const query = useInfiniteQuery<
    FragmentPage,
    Error,
    InfiniteData<FragmentPage>,
    string[],
    string | null
  >({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) =>
      api
        .get("/api/fragments", {
          searchParams: pageParam ? { cursor: pageParam } : {},
          signal,
        })
        .json<FragmentPage>(),
    queryKey: ["fragments"],
  });
  const items = flatten(query.data?.pages ?? []);

  if (isExpired(query.error)) {
    return <SessionExpired />;
  }

  return (
    <>
      {query.isError ? (
        <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <AlertDescription className="text-foreground">
            Couldn’t load your memories.
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

      <section aria-busy={query.isFetching} aria-label="Memories">
        {query.isPending ? (
          <div className="divide-y" role="status">
            <span className="sr-only">Loading memories</span>
            {[1, 2, 3].map((key) => (
              <div className="space-y-2 py-3.5" key={key}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}
        {query.isSuccess && items.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-16 text-center">
            <Layers
              aria-hidden="true"
              className="text-muted-foreground mx-auto mb-4 size-6"
            />
            <h2 className="font-medium">No memories yet</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              What your AI saves shows up here.{" "}
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
        <ul className="divide-y">
          {items.map((item) => (
            <li className="space-y-1 py-3.5" key={item.ref}>
              <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 text-xs">
                <span className="font-mono">{item.ref}</span>
                <time
                  dateTime={item.updatedAt}
                  title={new Date(item.updatedAt).toLocaleString()}
                >
                  {formatRelativeDate(item.updatedAt)}
                </time>
              </div>
              <p className="text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {item.fragment}
              </p>
            </li>
          ))}
        </ul>
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
    </>
  );
};
