import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { SessionExpired } from "@/components/session-expired";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, failure, isExpired } from "@/lib/api";
import { diffWords } from "@/lib/diff";
import type { Part } from "@/lib/diff";

import type {
  ForgottenList,
  FragmentPage,
  History,
  Restored,
  Version,
} from "../contract/memory";
import { formatRelativeDate } from "../lib/date";

type Label = "Edited" | "Forgotten" | "Restored" | "Saved";

interface Entry {
  diff: Part[] | null;
  label: Label;
  version: Version;
}

// The log does not record why a version was written, so the label comes from
// its text: a text seen before was restored.
const entries = (versions: Version[]): Entry[] => {
  const seen = new Set<string>();
  let previous: string | null = null;
  return versions
    .toReversed()
    .map((version): Entry => {
      const text = version.fragment;
      if (text === null) {
        return { diff: null, label: "Forgotten", version };
      }
      const before = previous;
      const restored = seen.has(text);
      seen.add(text);
      previous = text;
      if (restored) {
        return { diff: null, label: "Restored", version };
      }
      return before === null
        ? { diff: null, label: "Saved", version }
        : { diff: diffWords(before, text), label: "Edited", version };
    })
    .toReversed();
};

const stamp = (at: string) =>
  `${formatRelativeDate(at)}, ${new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;

// Row links carry this id so focus can return to them.
export const memoryId = (ref: string) => `memory-${ref}`;

// A row opens its history when clicked anywhere, unless the click selected
// text or landed on one of the row's own controls. Menus render in a portal,
// so their clicks bubble through React but not through the row's DOM.
export const useOpenHistory = () => {
  const navigate = useNavigate();
  return (to: string) => (event: MouseEvent<HTMLElement>) => {
    const { currentTarget, target } = event;
    if (
      !(target instanceof Element) ||
      !currentTarget.contains(target) ||
      target.closest("a, button") ||
      window.getSelection()?.toString()
    ) {
      return;
    }
    void navigate(to);
  };
};

// The dialog is a child route; when it closes, focus returns to the row
// that opened it.
export const useReturnFocus = () => {
  const { ref } = useParams();
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (ref) {
      opened.current = ref;
    } else if (opened.current) {
      document
        .querySelector<HTMLElement>(`#${memoryId(opened.current)}`)
        ?.focus();
      opened.current = null;
    }
  }, [ref]);
};

// The restored memory keeps its place in the loaded list until the list
// reloads, so restoring never makes a row jump out of view.
const showInList = (queryClient: QueryClient, restored: Restored) => {
  const { at, fragment, ref, versions } = restored;
  if (fragment === null) {
    return;
  }
  let found = false;
  queryClient.setQueryData<InfiniteData<FragmentPage>>(
    ["fragments"],
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          fragments: page.fragments.map((item) => {
            if (item.ref !== ref) {
              return item;
            }
            found = true;
            return { at, fragment, ref, versions };
          }),
        })),
      }
  );
  if (!found) {
    void queryClient.invalidateQueries({ queryKey: ["fragments"] });
  }
};

export const useRestore = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: { at: string; ref: string }) =>
      api.post("/api/restore", { json: version }).json<Restored>(),
    onSuccess: (restored) => {
      const { at, fragment, ref } = restored;
      queryClient.setQueryData<History>(
        ["history", ref],
        (data) =>
          data && { versions: [{ at, fragment, ref }, ...data.versions] }
      );
      showInList(queryClient, restored);
      void queryClient.invalidateQueries({ queryKey: ["forgotten"] });
    },
  });
};

// Delete is the user's purge: unlike forgetting, it removes the history too.
export const DeleteButton = ({
  before,
  onDeleted,
  target,
}: {
  before?: ReactNode;
  onDeleted?: () => void;
  target: string;
}) => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const purge = useMutation({
    mutationFn: () => api.post("/api/purge", { json: { ref: target } }),
    onSuccess: () => {
      queryClient.setQueryData<InfiniteData<FragmentPage>>(
        ["fragments"],
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              fragments: page.fragments.filter(({ ref }) => ref !== target),
            })),
          }
      );
      queryClient.setQueryData<ForgottenList>(
        ["forgotten"],
        (data) =>
          data && {
            fragments: data.fragments.filter(({ ref }) => ref !== target),
          }
      );
      onDeleted?.();
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {purge.isError ? (
        <span className="text-destructive text-xs">
          Couldn’t delete this memory. Try again.
        </span>
      ) : null}
      {confirming ? (
        <>
          <span className="text-foreground text-xs">
            Delete this memory and its history for good?
          </span>
          <Button
            disabled={purge.isPending}
            onClick={() => {
              setConfirming(false);
              purge.reset();
            }}
            size="sm"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={purge.isPending}
            onClick={() => purge.mutate()}
            size="sm"
            variant="destructive"
          >
            {purge.isPending ? "Deleting…" : "Delete"}
          </Button>
        </>
      ) : (
        <>
          {before}
          <Button
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirming(true)}
            size="sm"
            variant="ghost"
          >
            Delete
          </Button>
        </>
      )}
    </div>
  );
};

const Text = ({ entry }: { entry: Entry }) => {
  const className =
    "text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap";
  if (!entry.diff) {
    return <p className={className}>{entry.version.fragment}</p>;
  }
  return (
    <p className={className}>
      {entry.diff.map(({ kind, text }, index) => {
        const key = `${index}-${kind}`;
        if (kind === "removed") {
          return (
            <del
              className="bg-destructive/10 text-destructive decoration-destructive/60 rounded-sm"
              key={key}
            >
              {text}
            </del>
          );
        }
        if (kind === "added") {
          return (
            <ins
              className="rounded-sm bg-emerald-500/15 text-emerald-800 decoration-emerald-600/60 underline-offset-2 dark:text-emerald-300"
              key={key}
            >
              {text}
            </ins>
          );
        }
        return <span key={key}>{text}</span>;
      })}
    </p>
  );
};

const Timeline = ({ versions }: { versions: Version[] }) => {
  const restore = useRestore();
  const [fresh, setFresh] = useState<string | null>(null);
  const newest = useRef<HTMLLIElement>(null);
  const current = versions[0]?.fragment ?? null;
  // A forgotten memory's most recent text is the one to bring back.
  const latestText = versions.find(({ fragment }) => fragment !== null);

  // A restore lands at the top, maybe out of view: show it and point it out.
  useEffect(() => {
    if (!fresh) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    newest.current?.scrollIntoView({
      behavior: reduce.matches ? "auto" : "smooth",
      block: "nearest",
    });
    newest.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => setFresh(null), 2000);
    return () => clearTimeout(timer);
  }, [fresh]);

  return (
    <>
      {restore.isError ? (
        <p className="text-destructive mb-3 text-xs" role="alert">
          Couldn’t restore. Try again.
        </p>
      ) : null}
      <ol>
        {entries(versions).map((entry, index) => {
          const { fragment, at } = entry.version;
          const isCurrent = index === 0 && fragment !== null;
          const canRestore = fragment !== null && fragment !== current;
          return (
            <li
              className="group relative pb-5 pl-6 outline-none last:pb-0"
              key={at}
              ref={index === 0 ? newest : undefined}
              tabIndex={index === 0 ? -1 : undefined}
            >
              <span
                aria-hidden="true"
                className="bg-border absolute top-4 bottom-0 left-[3.5px] w-px group-last:hidden"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-2.5 left-0 size-2 rounded-full",
                  index === 0 ? "bg-foreground" : "bg-muted-foreground/40"
                )}
              />
              <div
                className={cn(
                  "-mx-2 space-y-1 rounded-lg px-2 py-1 transition-colors duration-700",
                  fresh === at && "bg-muted"
                )}
              >
                <div className="text-muted-foreground flex min-h-7 items-center justify-between gap-3 text-xs">
                  <span>
                    <span className="text-foreground font-medium">
                      {entry.label}
                    </span>
                    {" · "}
                    <time dateTime={at} title={new Date(at).toLocaleString()}>
                      {stamp(at)}
                    </time>
                  </span>
                  {isCurrent ? <span>Current</span> : null}
                  {canRestore ? (
                    <Button
                      disabled={restore.isPending}
                      onClick={() =>
                        restore.mutate(
                          { at, ref: entry.version.ref },
                          { onSuccess: (restored) => setFresh(restored.at) }
                        )
                      }
                      size="sm"
                      variant={
                        current === null && entry.version === latestText
                          ? "default"
                          : "outline"
                      }
                    >
                      Restore
                    </Button>
                  ) : null}
                </div>
                {fragment === null ? null : <Text entry={entry} />}
                {fragment === null && index === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Your AI can’t recall this.
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
};

// Every version of one memory, over the list that opened it.
export const HistoryDialog = () => {
  const { ref = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const query = useQuery({
    queryFn: ({ signal }) =>
      api.get(`/api/fragments/${ref}/history`, { signal }).json<History>(),
    queryKey: ["history", ref],
  });
  // Back returns to the list as it was; a link opened directly has no list
  // behind it in history, so it replaces itself with one.
  const close = () => {
    void (location.key === "default"
      ? navigate("..", { replace: true })
      : navigate(-1));
  };
  const missing = query.error !== null && failure(query.error).status === 404;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-h-[85dvh] sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>
            History
            <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">
              {ref}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {isExpired(query.error) ? <SessionExpired /> : null}
          {missing ? (
            <p className="text-muted-foreground text-sm">Memory not found.</p>
          ) : null}
          {query.isError && !missing && !isExpired(query.error) ? (
            <Alert className="flex flex-wrap items-center justify-between gap-3">
              <AlertDescription className="text-foreground">
                Couldn’t load history.
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
          {query.isPending ? (
            <div className="space-y-5" role="status">
              <span className="sr-only">Loading history</span>
              {[1, 2].map((key) => (
                <div className="space-y-2" key={key}>
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : null}
          {query.data ? (
            <>
              <Timeline versions={query.data.versions} />
              <div className="mt-6 border-t pt-4">
                <DeleteButton onDeleted={close} target={ref} />
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
