import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Link, Outlet } from "react-router";

import { useRestore } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { api, isExpired } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { listCard, listCardLink } from "@/shared/ui/list-card";
import { Skeleton } from "@/shared/ui/skeleton";
import { toasts } from "@/shared/ui/toaster";
import {
  MemoryText,
  memoryId,
  useOpenHistory,
  useReturnFocus,
} from "@/widgets/memory-history";
import type { ForgottenFragment, ForgottenList } from "@contract/memory";
import { formatRelativeDateInline } from "@lib/date";

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

// Memories an agent or the user forgot: out of recall, still in the log.
export const ForgottenView = () => {
  const query = useQuery({
    queryFn: ({ signal }) =>
      api.get("/api/fragments/forgotten", { signal }).json<ForgottenList>(),
    queryKey: ["forgotten"],
  });
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
        {query.isPending ? (
          <div className="space-y-2" role="status">
            <span className="sr-only">Loading forgotten memories</span>
            {[1, 2].map((key) => (
              <div className={cn(listCard, "space-y-2 py-3.5")} key={key}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}
        {query.data?.fragments.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
            Nothing forgotten.
          </p>
        ) : null}
        <ul className="space-y-2">
          {query.data?.fragments.map((item) => (
            <ForgottenRow item={item} key={item.ref} />
          ))}
        </ul>
      </section>
      <Outlet />
    </>
  );
};
