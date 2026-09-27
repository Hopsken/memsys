import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "react-router";

import { SessionExpired } from "@/components/session-expired";
import { toasts } from "@/components/toaster";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, isExpired } from "@/lib/api";

import type { ForgottenFragment, ForgottenList } from "../contract/memory";
import { formatRelativeDateInline } from "../lib/date";
import {
  memoryId,
  useOpenHistory,
  useRestore,
  useReturnFocus,
} from "./history";

const ForgottenRow = ({ item }: { item: ForgottenFragment }) => {
  const open = useOpenHistory();
  const restore = useRestore();
  return (
    <li>
      <div
        className="hover:bg-muted/50 -mx-3 my-1 cursor-pointer space-y-1 rounded-lg px-3 py-2.5"
        onClick={open(item.ref)}
      >
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
            className="text-foreground"
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
        <p className="text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
          {item.fragment}
        </p>
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
          <div className="divide-y" role="status">
            <span className="sr-only">Loading forgotten memories</span>
            {[1, 2].map((key) => (
              <div className="space-y-2 py-3.5" key={key}>
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
        <ul className="divide-y">
          {query.data?.fragments.map((item) => (
            <ForgottenRow item={item} key={item.ref} />
          ))}
        </ul>
      </section>
      <Outlet />
    </>
  );
};
