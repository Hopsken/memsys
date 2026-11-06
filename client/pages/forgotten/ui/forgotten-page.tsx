import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { Link, Outlet } from "react-router";
import { Skeleton } from "skullet/react";

import { MemoryLength, useRestore } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { api, isExpired } from "@/shared/api";
import type { ForgottenFragment } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { listCardLink } from "@/shared/ui/list-card";
import { toasts } from "@/shared/ui/toaster";
import {
  MemoryText,
  memoryId,
  useOpenHistory,
  useReturnFocus,
} from "@/widgets/memory-history";
import { formatRelativeDateInline } from "@lib/date";

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// A forgotten memory, with the line above it and the Restore button its row
// carries. Skullet measures these into the list's skeleton.
const SAMPLE_FORGOTTEN: ForgottenFragment[] = [
  {
    at: minutesAgo(2100),
    by: "agent:Claude",
    forgottenAt: minutesAgo(1500),
    fragment: "Uses pnpm, never npm.",
    ref: "m_4hd2Ls8n",
  },
  {
    at: minutesAgo(4300),
    by: "user",
    forgottenAt: minutesAgo(2880),
    fragment:
      "Keeps one branch per change and squashes before merging, so the history reads as one decision.",
    ref: "m_5tx9Qa2k",
  },
];

const ForgottenRow = ({ item }: { item: ForgottenFragment }) => {
  const open = useOpenHistory();
  const restore = useRestore();
  return (
    <li>
      <div className={listCardLink} onClick={open(item.ref)}>
        <div className="text-muted-foreground flex min-h-7 flex-wrap items-center gap-x-2 text-xs">
          <Link
            className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm font-mono outline-none focus-visible:ring-3"
            id={memoryId(item.ref)}
            to={item.ref}
          >
            {item.ref}
          </Link>
          <MemoryLength text={item.fragment} />
          <span aria-hidden="true">·</span>
          <time
            className="flex-1"
            dateTime={item.forgottenAt}
            title={new Date(item.forgottenAt).toLocaleString()}
          >
            Forgotten {formatRelativeDateInline(item.forgottenAt)}
          </time>
          <Button
            className="text-foreground -mr-2"
            disabled={restore.isPending}
            onClick={() =>
              restore.mutate(
                { at: item.at, ref: item.ref },
                { onSuccess: () => toasts.add({ title: "Restored" }) }
              )
            }
            size="xs"
            variant="ghost"
          >
            Restore
          </Button>
        </div>
        <MemoryText text={item.fragment} />
        {restore.isError ? (
          <p className="text-destructive text-xs">
            Couldn’t restore. Try again.
          </p>
        ) : null}
      </div>
    </li>
  );
};

export const ForgottenView = () => {
  const query = useQuery({
    queryFn: ({ signal }) =>
      parseResponse(
        api.fragments.forgotten.$get(undefined, { init: { signal } })
      ),
    queryKey: ["forgotten"],
  });
  const fragments = query.data?.fragments ?? [];
  useReturnFocus();

  if (isExpired(query.error)) {
    return <SessionExpired />;
  }

  return (
    <>
      <header className="mb-4">
        <h2 className="font-medium">Forgotten memories</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Your AI can’t recall these.
        </p>
      </header>

      {query.isError ? (
        <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <AlertDescription className="text-foreground">
            Couldn’t load forgotten memories.
          </AlertDescription>
          <Button
            onClick={() => {
              void query.refetch();
            }}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </Alert>
      ) : null}

      <section aria-busy={query.isFetching} aria-label="Forgotten memories">
        <Skeleton
          data={query.isPending ? null : fragments}
          id="forgotten"
          label="Loading forgotten memories"
          sample={SAMPLE_FORGOTTEN}
        >
          {(items) => (
            <ul className="space-y-2">
              {items.map((item) => (
                <ForgottenRow item={item} key={item.ref} />
              ))}
            </ul>
          )}
        </Skeleton>
        {query.data?.fragments.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            Nothing forgotten.
          </p>
        ) : null}
      </section>
      <Outlet />
    </>
  );
};
