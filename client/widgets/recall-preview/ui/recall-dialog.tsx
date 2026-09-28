import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Search, SearchX, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";

import { SessionExpired } from "@/features/auth";
import { api, isExpired } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import type { RecallItem, RecallResult } from "@contract/memory";
import type { PluginView } from "@contract/plugin";
import { findAnchors } from "@lib/anchor";
import { formatRelativeDate } from "@lib/date";

import { groupByMatch } from "../lib/group";

// Show more asks for this many more memories each time.

interface Request {
  context: string;
  cue: string;
}

// Tags stay muted but aren't links: the whole row opens the memory.
const TagMuted = ({ text }: { text: string }) => {
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const { end, start } of findAnchors(text)) {
    nodes.push(
      text.slice(at, start),
      <span className="text-muted-foreground" key={start}>
        {text.slice(start, end)}
      </span>
    );
    at = end;
  }
  nodes.push(text.slice(at));
  return <>{nodes}</>;
};

// One memory as a row; clicking it opens its history.
const MemoryRow = ({
  item,
  onOpen,
}: {
  item: RecallItem;
  onOpen: (ref: string) => void;
}) => (
  <button
    className="hover:bg-muted focus-visible:ring-ring/50 -mx-2 flex w-[calc(100%+1rem)] items-baseline gap-4 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3"
    onClick={() => onOpen(item.ref)}
    type="button"
  >
    <span className="min-w-0 flex-1">
      <span className="block text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
        <TagMuted text={item.fragment} />
      </span>
      {item.via ? (
        <span className="text-muted-foreground block text-xs">
          Shares {item.via.map((tag) => `#${tag}`).join(", ")}
        </span>
      ) : null}
    </span>
    <time
      className="text-muted-foreground shrink-0 text-xs"
      dateTime={item.at}
      title={new Date(item.at).toLocaleString()}
    >
      {formatRelativeDate(item.at)}
    </time>
  </button>
);

// Each match with the memories it brought along, so the reach of every
// match shows at a glance.
const Results = ({
  onOpen,
  result,
}: {
  onOpen: (ref: string) => void;
  result: RecallResult;
}) => (
  <>
    {result.warnings?.map((warning) => (
      <p className="text-muted-foreground mb-3 text-xs" key={warning}>
        {warning}
      </p>
    ))}
    {result.fragments.length === 0 ? (
      <div className="py-10 text-center">
        <SearchX
          aria-hidden="true"
          className="text-muted-foreground mx-auto mb-4 size-6"
        />
        <h3 className="font-medium">Your AI would find nothing</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Try fewer words, or a #tag.
        </p>
      </div>
    ) : null}
    <ul className="space-y-3">
      {groupByMatch(result.fragments).map(({ match, related }) => (
        <li key={match?.ref ?? "related"}>
          {match ? <MemoryRow item={match} onOpen={onOpen} /> : null}
          {related.length > 0 ? (
            <ul
              aria-label="Sharing a tag"
              className={cn(match && "mt-0.5 ml-1 border-l pl-4")}
            >
              {related.map((item) => (
                <li key={item.ref}>
                  <MemoryRow item={item} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
    {result.hasMore ? (
      <p className="text-muted-foreground mt-4 text-center text-sm">
        More memories matched than your AI gets. Try something more specific.
      </p>
    ) : null}
  </>
);

// Runs a cue through the same recall your AI uses and shows what comes back.
// Nothing is kept once the dialog closes.
const RecallPanel = ({
  cueInput,
  history,
}: {
  cueInput: RefObject<HTMLInputElement | null>;
  history: (ref: string, onClose: () => void) => ReactNode;
}) => {
  const [draft, setDraft] = useState<Request>({ context: "", cue: "" });
  const [request, setRequest] = useState<Request | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const plugins = useQuery({
    queryFn: ({ signal }) =>
      api.get("/api/plugins", { signal }).json<PluginView[]>(),
    queryKey: ["plugins"],
  });
  // Only the relevance filter reads the context.
  const judged =
    plugins.data?.some(({ enabled, name }) => enabled && name === "jev") ??
    false;
  const query = useQuery({
    enabled: request !== null,
    // A new search keeps the current results until its own arrive.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api
        .post("/api/recall", {
          json: {
            cue: request?.cue,
            ...(request?.context && { context: request.context }),
          },
          signal,
        })
        .json<RecallResult>(),
    queryKey: ["recall", request],
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = {
      context: judged ? draft.context.trim() : "",
      cue: draft.cue.trim(),
    };
    if (!next.cue) {
      cueInput.current?.focus();
      return;
    }
    if (
      request &&
      next.cue === request.cue &&
      next.context === request.context
    ) {
      void query.refetch();
      return;
    }
    setRequest(next);
  };

  const result = query.data;

  return (
    <>
      <form className="space-y-2 border-b px-5 py-4" onSubmit={submit}>
        <div className="flex gap-2">
          <Input
            aria-label="Search"
            autoComplete="off"
            className="h-9"
            maxLength={256}
            onChange={(event) =>
              setDraft({ ...draft, cue: event.target.value })
            }
            placeholder="A topic, a name, or a #tag"
            ref={cueInput}
            value={draft.cue}
          />
          <Button className="h-9" disabled={query.isFetching} type="submit">
            Search
          </Button>
        </div>
        {judged ? (
          <Input
            aria-label="What your AI is working on"
            autoComplete="off"
            className="h-9"
            maxLength={1000}
            onChange={(event) =>
              setDraft({ ...draft, context: event.target.value })
            }
            placeholder="What your AI is working on (optional)"
            value={draft.context}
          />
        ) : null}
      </form>
      <section
        aria-busy={query.isFetching}
        aria-label="Results"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-5 py-5 transition-opacity",
          query.isPlaceholderData && "opacity-50"
        )}
      >
        {request === null ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            Search as your AI would to see which memories come back.
          </p>
        ) : null}
        {isExpired(query.error) ? <SessionExpired /> : null}
        {query.isError && !isExpired(query.error) ? (
          <Alert className="flex flex-wrap items-center justify-between gap-3">
            <AlertDescription className="text-foreground">
              Couldn’t search your memories.
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
        {request && query.isPending ? (
          <div className="space-y-3" role="status">
            <span className="sr-only">Searching</span>
            {[1, 2, 3].map((key) => (
              <div className="space-y-2 py-1.5" key={key}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}
        {result ? <Results onOpen={setOpened} result={result} /> : null}
      </section>
      {/* An edit or forget in the history shows in the results once it
      closes. */}
      {opened
        ? history(opened, () => {
            setOpened(null);
            void query.refetch();
          })
        : null}
    </>
  );
};

// `history` renders a memory's history over the dialog; the app supplies it
// so this widget stays apart from the one that shows histories.
export const RecallPreview = ({
  className,
  history,
}: {
  className?: string;
  history: (ref: string, onClose: () => void) => ReactNode;
}) => {
  const cueInput = useRef<HTMLInputElement>(null);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            aria-label="What your AI recalls"
            className={className}
            title="What your AI recalls"
          />
        }
      >
        <Search aria-hidden="true" />
      </DialogTrigger>
      <DialogContent
        // The history opens over this dialog, which dims under it.
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-black/0 after:transition-colors data-nested-dialog-open:after:bg-black/10 sm:max-h-[85dvh] sm:max-w-2xl"
        initialFocus={cueInput}
        showCloseButton={false}
      >
        <DialogHeader className="min-h-15 flex-row items-center gap-3 border-b py-3 pr-3 pl-5">
          <DialogTitle className="flex-1">What your AI recalls</DialogTitle>
          <DialogClose
            render={
              <Button aria-label="Close" size="icon-sm" variant="ghost" />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        <RecallPanel cueInput={cueInput} history={history} />
      </DialogContent>
    </Dialog>
  );
};
