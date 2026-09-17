import { History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { Fragment, Revision } from "../worker/memory";

const formatTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

// What changed between a revision and the one before it.
const describe = (revision: Revision, previous?: Revision) => {
  if (!previous) {
    return "Remembered";
  }
  if (revision.archived !== previous.archived) {
    return revision.archived ? "Archived" : "Restored";
  }
  return "Revised";
};

const restore = async (ref: string, version?: number) => {
  const response = await fetch("/api/restore", {
    body: JSON.stringify(version === undefined ? { ref } : { ref, version }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Could not restore this fragment. Please try again.");
  }
};

const HistoryPanel = ({
  item,
  onRestore,
  onError,
}: {
  item: Fragment;
  onRestore: () => void;
  onError: (message: string) => void;
}) => {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // Reload whenever the head changes, so a restore shows up in the timeline.
  useEffect(() => {
    const controller = new AbortController();
    setRevisions(null);
    const load = async () => {
      try {
        const response = await fetch(`/api/fragments/${item.ref}/history`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Could not load history.");
        }
        const data: { revisions: Revision[] } = await response.json();
        setRevisions(data.revisions.toReversed());
      } catch {
        if (!controller.signal.aborted) {
          setRevisions([]);
          onError("Could not load history. Please try again.");
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [item.ref, item.version, onError]);

  const restoreVersion = async (version: number) => {
    setBusy(version);
    try {
      await restore(item.ref, version);
      onRestore();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  if (revisions === null) {
    return (
      <div className="space-y-3 pt-4" role="status">
        <span className="sr-only">Loading history</span>
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  return (
    <ol aria-label="History" className="space-y-3 pt-4">
      {revisions.map((revision, index) => {
        const previous = revisions[index + 1];
        const current = revision.version === item.version;
        return (
          <li
            className="text-muted-foreground border-l-2 pl-4 text-xs"
            key={revision.version}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span>
                <span className="text-foreground font-medium">
                  {describe(revision, previous)}
                </span>
                {" · v"}
                {revision.version}
                {current ? " · Current" : ""}
              </span>
              <span className="flex items-center gap-2">
                <time dateTime={revision.createdAt}>
                  {formatTime(revision.createdAt)}
                </time>
                {current ? null : (
                  <Button
                    disabled={busy !== null}
                    onClick={() => {
                      void restoreVersion(revision.version);
                    }}
                    size="xs"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" />
                    Restore
                  </Button>
                )}
              </span>
            </div>
            {previous?.fragment === revision.fragment ? null : (
              <p className="text-foreground/80 mt-1 leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {revision.fragment}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export const FragmentCard = ({
  item,
  archived,
  onChange,
}: {
  item: Fragment;
  archived: boolean;
  onChange: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const panelId = `history-${item.ref}`;

  const unarchive = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await restore(item.ref);
      onChange();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border bg-white p-5 sm:p-6">
      <div className="text-muted-foreground mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <span className="font-mono">
          {item.ref}
          {item.version > 1 ? ` · v${item.version}` : ""}
        </span>
        <time
          dateTime={item.updatedAt}
          title={`${archived ? "Archived" : "Updated"} ${new Date(item.updatedAt).toLocaleString()}`}
        >
          {formatTime(item.updatedAt)}
        </time>
      </div>
      <p className="text-sm leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap">
        {item.fragment}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          size="xs"
          variant="ghost"
        >
          <History aria-hidden="true" />
          History
        </Button>
        {archived ? (
          <Button
            disabled={busy}
            onClick={() => {
              void unarchive();
            }}
            size="xs"
            variant="outline"
          >
            <RotateCcw aria-hidden="true" />
            Restore
          </Button>
        ) : null}
      </div>
      {failure ? (
        <p className="text-destructive mt-3 text-xs" role="alert">
          {failure}
        </p>
      ) : null}
      {open ? (
        <div className="mt-4 border-t" id={panelId}>
          <HistoryPanel
            item={item}
            onError={setFailure}
            onRestore={() => {
              setFailure(null);
              onChange();
            }}
          />
        </div>
      ) : null}
    </li>
  );
};
