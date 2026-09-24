import { useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { ArrowDown, Layers } from "lucide-react";

import { SessionExpired } from "@/components/session-expired";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isExpired } from "@/lib/api";
import { formatRelativeDate } from "@/lib/date";

import type { Fragment, FragmentPage } from "../contract/memory";

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
            Could not load memory.
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

      <section aria-busy={query.isFetching} aria-label="Fragments">
        {query.isPending ? (
          <div className="space-y-2.5" role="status">
            <span className="sr-only">Loading memory</span>
            {[1, 2, 3].map((key) => (
              <Card className="gap-2 px-4 py-3.5 sm:px-5" key={key}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-2/3" />
              </Card>
            ))}
          </div>
        ) : null}
        {query.isSuccess && items.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-16 text-center">
            <Layers
              aria-hidden="true"
              className="text-muted-foreground mx-auto mb-4 size-6"
            />
            <h2 className="font-medium">No fragments yet</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Save a memory through your connected agent to see it here.
            </p>
          </div>
        ) : null}
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.ref}>
              <Card className="gap-1 px-4 py-3.5 sm:px-5">
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
              </Card>
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
