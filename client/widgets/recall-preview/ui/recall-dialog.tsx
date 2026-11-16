import { skipToken, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { Search, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";

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
        Couldn’t reach your memories.
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
  contextInput,
}: {
  contextInput: RefObject<HTMLInputElement | null>;
}) => {
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<string | null>(null);
  const query = useQuery({
    queryFn:
      request === null
        ? skipToken
        : ({ signal }) =>
            parseResponse(
              api.recall.$post(
                { json: { context: request } },
                { init: { signal } }
              )
            ),
    queryKey: ["recall", request],
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) {
      contextInput.current?.focus();
      return;
    }
    if (next === request) {
      void query.refetch();
      return;
    }
    setRequest(next);
  };

  return (
    <>
      <form className="flex gap-2 border-b px-5 py-4" onSubmit={submit}>
        <Input
          aria-label="What your AI is working on"
          autoComplete="off"
          className="h-9"
          maxLength={8000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What your AI is working on"
          ref={contextInput}
          value={draft}
        />
        <Button className="h-9" disabled={query.isFetching} type="submit">
          Ask
        </Button>
      </form>
      <section
        aria-busy={query.isFetching}
        aria-label="Answer"
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      >
        {request === null ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            Ask as your AI would to see what memory answers.
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
            <span className="sr-only">Reading your memories</span>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : null}
        {query.data ? (
          <p className="text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">
            {query.data.answer}
          </p>
        ) : null}
      </section>
    </>
  );
};

export const RecallPreview = ({ className }: { className?: string }) => {
  const contextInput = useRef<HTMLInputElement>(null);
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
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-h-[85dvh] sm:max-w-2xl"
        initialFocus={contextInput}
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
        <RecallPanel contextInput={contextInput} />
      </DialogContent>
    </Dialog>
  );
};
