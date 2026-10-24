import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Search, SearchX, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";

import { MemoryLength, useSettings } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { api, failure, isExpired } from "@/shared/api";
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
import { findAnchors } from "@lib/anchor";
import { formatRelativeDate } from "@lib/date";

import { groupByMatch } from "../lib/group";

interface Request {
  context: string;
  cue: string;
}

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
    <span className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
      <MemoryLength text={item.fragment} />
      <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>
        {formatRelativeDate(item.at)}
      </time>
    </span>
  </button>
);

const Results = ({
  onOpen,
  result,
}: {
  onOpen: (ref: string) => void;
  result: RecallResult;
}) => (
  <>
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
    {result.truncated ? (
      <p className="text-muted-foreground mt-4 text-center text-sm">
        More memories match. Try something more specific.
      </p>
    ) : null}
  </>
);

const RecallError = ({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) => {
  const { problem } = failure(error);
  return (
    <Alert className="flex flex-wrap items-center justify-between gap-3">
      <AlertDescription className="text-foreground min-w-0 flex-1">
        Couldn’t search your memories.
        {problem.error ? (
          <span className="text-muted-foreground mt-1 block text-xs [overflow-wrap:anywhere]">
            {problem.error}
          </span>
        ) : null}
      </AlertDescription>
      {problem.retry === false ? null : (
        <Button onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      )}
    </Alert>
  );
};

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
  const judged =
    (useSettings().data?.settings.relevanceFilter ?? "off") !== "off";
  const query = useQuery({
    enabled: request !== null,
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
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      >
        {request === null ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            Search as your AI would to see which memories come back.
          </p>
        ) : null}
        {isExpired(query.error) ? <SessionExpired /> : null}
        {query.isError && !isExpired(query.error) ? (
          <RecallError
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
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
      {opened
        ? history(opened, () => {
            setOpened(null);
            void query.refetch();
          })
        : null}
    </>
  );
};

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
