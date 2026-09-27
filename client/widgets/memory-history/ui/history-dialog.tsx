import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Archive, Trash2, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { removeFromList, restoreVersion, useRestore } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { api, failure, isExpired } from "@/shared/api";
import { diffWords } from "@/shared/lib/diff";
import type { Part } from "@/shared/lib/diff";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { toasts } from "@/shared/ui/toaster";
import type { ForgottenList, History, Version } from "@contract/memory";
import { formatRelativeDate } from "@lib/date";

type Label = "Edited" | "Forgotten" | "New" | "Restored";

// Edited is the usual step, so it stays plain; the rest stand out. Red and
// green belong to the diff.
const BADGES = {
  Edited: null,
  Forgotten: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  New: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  Restored: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
} satisfies Record<Label, string | null>;

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
        ? { diff: null, label: "New", version }
        : { diff: diffWords(before, text), label: "Edited", version };
    })
    .toReversed();
};

const stamp = (at: string) =>
  `${formatRelativeDate(at)}, ${new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;

// Forgetting closes the dialog and leaves a toast to undo it, which puts the
// memory back where it was in the list.
const useForget = (onForgotten: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ref }: Version) =>
      api.post("/api/forget", { json: { ref } }),
    onSuccess: (_, current) => {
      const position = removeFromList(queryClient, current.ref);
      void queryClient.invalidateQueries({ queryKey: ["forgotten"] });
      void queryClient.invalidateQueries({
        queryKey: ["history", current.ref],
      });
      onForgotten();
      const id = toasts.add({
        actionProps: {
          children: "Undo",
          onClick: async () => {
            toasts.close(id);
            try {
              await restoreVersion(queryClient, current, position);
            } catch {
              toasts.add({
                title: "Couldn’t restore. It’s in Forgotten memories.",
              });
            }
          },
        },
        title: "Forgotten",
      });
    },
  });
};

// Delete is the user's purge: unlike forgetting, it removes the history too.
// It is the next step for a forgotten memory, as Forget is for a live one,
// and waits behind a confirmation.
const DeleteMemory = ({
  onDeleted,
  target,
}: {
  onDeleted: () => void;
  target: string;
}) => {
  const queryClient = useQueryClient();
  const purge = useMutation({
    mutationFn: () => api.post("/api/purge", { json: { ref: target } }),
    onSuccess: () => {
      queryClient.setQueryData<ForgottenList>(
        ["forgotten"],
        (data) =>
          data && {
            fragments: data.fragments.filter(({ ref }) => ref !== target),
          }
      );
      onDeleted();
    },
  });
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          purge.reset();
        }
      }}
    >
      <AlertDialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Trash2 aria-hidden="true" />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
          <AlertDialogDescription>
            Its history goes with it, and you won’t be able to restore it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {purge.isError ? (
          <p className="text-destructive text-sm" role="alert">
            Couldn’t delete this memory. Try again.
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={purge.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={purge.isPending}
            onClick={() => purge.mutate()}
            variant="destructive"
          >
            {purge.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "text-foreground font-medium",
                        BADGES[entry.label] &&
                          cn("rounded-md px-1.5 py-0.5", BADGES[entry.label])
                      )}
                    >
                      {entry.label}
                    </span>
                    <span aria-hidden="true">·</span>
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
                      variant="outline"
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
  const forget = useForget(close);
  // The header offers the next step down: Forget for a memory your AI can
  // still recall, Delete for a forgotten one.
  const current = query.data?.versions[0];
  // Focus starts on the history, not on an action one Enter away.
  const body = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <DialogContent
        // A nested dialog, such as the delete confirmation, has no backdrop
        // of its own, so this one dims instead.
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-black/0 after:transition-colors data-nested-dialog-open:after:bg-black/10 sm:max-h-[85dvh] sm:max-w-xl"
        initialFocus={body}
        showCloseButton={false}
      >
        <DialogHeader className="min-h-15 flex-row items-center gap-3 border-b py-3 pr-3 pl-5">
          <DialogTitle className="flex-1">
            History
            <span className="text-muted-foreground ml-2 font-mono text-xs font-normal">
              {ref}
            </span>
          </DialogTitle>
          {current?.fragment ? (
            <Button
              disabled={forget.isPending}
              onClick={() => forget.mutate(current)}
              size="sm"
              variant="ghost"
            >
              <Archive aria-hidden="true" />
              Forget
            </Button>
          ) : null}
          {current && current.fragment === null ? (
            <DeleteMemory onDeleted={close} target={ref} />
          ) : null}
          <DialogClose
            render={
              <Button aria-label="Close" size="icon-sm" variant="ghost" />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5 outline-none"
          ref={body}
          tabIndex={-1}
        >
          {isExpired(query.error) ? <SessionExpired /> : null}
          {forget.isError ? (
            <p className="text-destructive mb-3 text-xs" role="alert">
              Couldn’t forget this memory. Try again.
            </p>
          ) : null}
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
          {query.data ? <Timeline versions={query.data.versions} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
