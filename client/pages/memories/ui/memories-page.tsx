import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { cn } from "cn";
import { parseResponse } from "hono/client";
import { ArrowDown, Hash, Layers } from "lucide-react";
import { useEffect } from "react";
import { Link, Outlet } from "react-router";
import { Skeleton } from "skullet/react";

import { authorLabel, usePersonas } from "@/entities/persona";
import { SessionExpired } from "@/features/auth";
import { AuthorFilter, useAuthorParam } from "@/features/author-filter";
import { useTags } from "@/features/tag-filter";
import { api, isExpired } from "@/shared/api";
import type { Author, FragmentPage, ListedFragment } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { useReturnFocus } from "@/widgets/memory-history";

import { FilterBar } from "./filter-bar";
import { MemoryList, SAMPLE_MEMORIES } from "./memory-list";

const linkClass =
  "text-foreground underline underline-offset-4 hover:text-foreground/80";

const latestPerRef = (pages: FragmentPage[]) => {
  const items = new Map<string, ListedFragment>();
  for (const item of pages.flatMap((page) => page.fragments)) {
    items.delete(item.ref);
    items.set(item.ref, item);
  }
  return [...items.values()];
};

const EmptyList = ({ by, tags }: { by: Author | null; tags: string[] }) => {
  const personas = usePersonas();
  if (by !== null) {
    const name = authorLabel(by, personas.data)?.name ?? "this agent";
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
        {tags.length > 0
          ? `No memories by ${name} with these tags.`
          : `No memories by ${name}.`}
      </p>
    );
  }
  if (tags.length > 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed px-6 py-16 text-center">
        <Hash
          aria-hidden="true"
          className="text-muted-foreground mx-auto mb-4 size-6"
        />
        <h2 className="font-medium">
          {tags.length === 1
            ? `No memories tagged #${tags[0]}`
            : "No memories have all these tags"}
        </h2>
      </div>
    );
  }
  return (
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
  );
};

export const FragmentsView = () => {
  const tags = useTags();
  const [by, setBy] = useAuthorParam();
  const query = useInfiniteQuery<
    FragmentPage,
    Error,
    InfiniteData<FragmentPage>,
    (string | Author | null | { tag: string[] })[],
    string | null
  >({
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam, signal }) =>
      parseResponse(
        api.fragments.$get(
          {
            query: {
              by: by ?? undefined,
              cursor: pageParam ?? undefined,
              tag: tags,
            },
          },
          { init: { signal } }
        )
      ),
    queryKey: ["fragments", by, { tag: tags }],
  });
  const items = latestPerRef(query.data?.pages ?? []);
  useReturnFocus();
  const filter = tags.join(" ");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [filter]);

  if (isExpired(query.error)) {
    return <SessionExpired />;
  }

  return (
    <>
      <FilterBar>
        <AuthorFilter by={by} onChange={setBy} />
      </FilterBar>
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

      <section
        aria-busy={query.isFetching}
        aria-label="Memories"
        className={cn(
          "transition-opacity",
          query.isPlaceholderData && "opacity-50"
        )}
      >
        <Skeleton
          data={query.isPending ? null : items}
          id="memories"
          label="Loading memories"
          sample={SAMPLE_MEMORIES}
        >
          {(memories) => <MemoryList items={memories} onSelectAuthor={setBy} />}
        </Skeleton>
        {query.isSuccess && items.length === 0 ? (
          <EmptyList by={by} tags={tags} />
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
