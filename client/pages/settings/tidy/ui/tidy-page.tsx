import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { parseResponse } from "hono/client";
import type { InferResponseType } from "hono/client";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import * as z from "zod/mini";

import { OP_COLORS } from "@/entities/memory";
import { SourceLine } from "@/entities/persona";
import { SessionExpired } from "@/features/auth";
import { api, failure, isExpired } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Checkbox } from "@/shared/ui/checkbox";
import { Skeleton } from "@/shared/ui/skeleton";
import { MemoryText } from "@/widgets/memory-history";

type TidyState = InferResponseType<typeof api.tidy.$get, 200>;
type Ready = Extract<TidyState, { status: "ready" }>;
type Proposal = Ready["proposals"][number];
type Change = Proposal["changes"][number];
type Skipped = NonNullable<
  Extract<TidyState, { status: "idle" }>["last"]
>["skipped"][number];

const TIDY = ["tidy"];
const POLL_MS = 3000;

const CHANGE_LABELS = {
  forget: "Forget",
  remember: "Add",
  revise: "Edit",
} satisfies Record<Change["type"], string>;

const CHANGE_COLORS = {
  forget: OP_COLORS.forget,
  remember: OP_COLORS.remember,
  revise: OP_COLORS.revise,
} satisfies Record<Change["type"], string>;

const badge = "rounded-md px-1.5 py-0.5 font-medium";
const cardBox = "bg-card rounded-xl px-4 py-3";

const proposalLabel = ({ changes }: Proposal) => {
  const types = new Set(changes.map(({ type }) => type));
  if (types.has("revise") && types.has("forget") && !types.has("remember")) {
    return "Merge";
  }
  if (types.has("revise") && types.has("remember") && !types.has("forget")) {
    return "Split";
  }
  return "Change";
};

const forgetsFirst = (proposals: Proposal[]) =>
  proposals.toSorted(
    (a, b) =>
      Number(b.changes.some(({ type }) => type === "forget")) -
      Number(a.changes.some(({ type }) => type === "forget"))
  );

const plural = (count: number) =>
  `${count} ${count === 1 ? "change" : "changes"}`;

const elapsed = (since: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const unselectedKey = (runId: string) => `tidy:${runId}:unselected`;

const unselectedSchema = z.array(z.string());

const readUnselected = (runId: string) => {
  try {
    const stored = z.safeParse(
      unselectedSchema,
      JSON.parse(sessionStorage.getItem(unselectedKey(runId)) ?? "[]")
    );
    return new Set(stored.data);
  } catch {
    return new Set<string>();
  }
};

const useUnselected = (runId: string) => {
  const [unselected, setUnselected] = useState(() => readUnselected(runId));
  useEffect(() => {
    setUnselected(readUnselected(runId));
  }, [runId]);
  const update = (next: Set<string>) => {
    sessionStorage.setItem(unselectedKey(runId), JSON.stringify([...next]));
    setUnselected(next);
  };
  return [unselected, update] as const;
};

const ChangeView = ({ change, many }: { change: Change; many: boolean }) => (
  <div className="space-y-0.5 [&+&]:mt-2 [&+&]:border-t [&+&]:pt-2">
    {many || change.type !== "remember" ? (
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
        {many ? (
          <span className={cn(badge, CHANGE_COLORS[change.type])}>
            {CHANGE_LABELS[change.type]}
          </span>
        ) : null}
        {change.type === "remember" ? null : (
          <>
            <SourceLine source={change.source} />
            <span className="font-mono">{change.ref}</span>
          </>
        )}
      </div>
    ) : null}
    {change.type === "remember" ? null : (
      <MemoryText
        className="text-muted-foreground decoration-muted-foreground/60 line-through"
        text={change.current}
      />
    )}
    {change.type === "forget" ? null : <MemoryText text={change.fragment} />}
  </div>
);

const ProposalView = ({
  note,
  proposal,
  onToggle,
  selected,
}: {
  note?: string;
  proposal: Proposal;
  onToggle?: (selected: boolean) => void;
  selected?: boolean;
}) => {
  const [only] = proposal.changes;
  const many = proposal.changes.length > 1;
  return (
    <li className={cn(cardBox, "flex gap-3")}>
      {onToggle ? (
        <Checkbox
          aria-label={`Include: ${proposal.reason}`}
          checked={selected}
          className="mt-1"
          onCheckedChange={onToggle}
        />
      ) : null}
      <div
        className={cn(
          "min-w-0 flex-1 space-y-1",
          onToggle && !selected && "opacity-55"
        )}
      >
        <div className="text-xs">
          {many || !only ? (
            <span className="font-medium">{proposalLabel(proposal)}</span>
          ) : (
            <span className={cn(badge, CHANGE_COLORS[only.type])}>
              {CHANGE_LABELS[only.type]}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-sm text-pretty">
          {proposal.reason}
        </p>
        {proposal.changes.map((change, index) => (
          <ChangeView
            change={change}
            // oxlint-disable-next-line react/no-array-index-key -- changes have no id and never reorder.
            key={index}
            many={many}
          />
        ))}
        {note ? (
          <p className="text-muted-foreground border-t pt-2 text-xs">{note}</p>
        ) : null}
      </div>
    </li>
  );
};

const Review = ({
  applying,
  onApply,
  state,
}: {
  applying: boolean;
  onApply: (ids: string[]) => void;
  state: Ready;
}) => {
  const [unselected, setUnselected] = useUnselected(state.runId);
  const proposals = forgetsFirst(state.proposals);
  const selected = proposals.filter(({ id }) => !unselected.has(id));
  const all = selected.length === proposals.length;

  if (proposals.length === 0) {
    return (
      <p className="text-muted-foreground mt-6 rounded-xl border border-dashed px-6 py-12 text-center text-sm">
        Your memory looks tidy.
      </p>
    );
  }
  return (
    <section aria-label="Proposed changes" className="mt-6">
      <p className="text-muted-foreground mb-2 text-sm">
        Found {plural(proposals.length)}. {state.summary}
      </p>
      <ul className="space-y-2">
        {proposals.map((proposal) => (
          <ProposalView
            key={proposal.id}
            onToggle={(include) => {
              const next = new Set(unselected);
              if (include) {
                next.delete(proposal.id);
              } else {
                next.add(proposal.id);
              }
              setUnselected(next);
            }}
            proposal={proposal}
            selected={!unselected.has(proposal.id)}
          />
        ))}
      </ul>
      <div className="bg-background sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 border-t py-3">
        <span className="text-muted-foreground text-sm">
          {selected.length} of {proposals.length} selected ·{" "}
          <button
            className="text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 outline-none focus-visible:ring-3"
            onClick={() =>
              setUnselected(new Set(all ? proposals.map(({ id }) => id) : []))
            }
            type="button"
          >
            {all ? "Select none" : "Select all"}
          </button>
        </span>
        <Button
          disabled={selected.length === 0 || applying}
          onClick={() => onApply(selected.map(({ id }) => id))}
        >
          Apply {plural(selected.length)}
        </Button>
      </div>
    </section>
  );
};

const Applied = ({
  applied,
  skipped,
}: {
  applied: number;
  skipped: Skipped[];
}) => (
  <section aria-label="Result" className="mt-6 space-y-4">
    <Alert className="flex flex-wrap items-center justify-between gap-3">
      <AlertDescription className="text-foreground">
        Applied {plural(applied)}.
      </AlertDescription>
      {applied > 0 ? (
        <Link
          className="text-foreground text-sm underline underline-offset-4"
          to="/activity?source=system"
        >
          See them in Activity
        </Link>
      ) : null}
    </Alert>
    {skipped.length > 0 ? (
      <div>
        <h2 className="text-muted-foreground pb-2 text-xs font-medium">
          Skipped
        </h2>
        <ul className="space-y-2">
          {skipped.map(({ proposal, reason }) => (
            <ProposalView key={proposal.id} note={reason} proposal={proposal} />
          ))}
        </ul>
      </div>
    ) : null}
  </section>
);

const Running = ({ startedAt }: { startedAt: string }) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section aria-label="Looking for changes" className="mt-6">
      <p className="text-muted-foreground mb-2 text-sm" role="status">
        Reading your memories… {elapsed(startedAt, now)}. This can take a few
        minutes. You can leave this page.
      </p>
      <div className="space-y-2">
        {[1, 2, 3].map((key) => (
          <div className={cn(cardBox, "space-y-2 py-3.5")} key={key}>
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </section>
  );
};

const TidyAction = ({
  busy,
  onCancel,
  onStart,
  state,
}: {
  busy: boolean;
  onCancel: () => void;
  onStart: () => void;
  state: TidyState;
}) => {
  switch (state.status) {
    case "running": {
      return (
        <Button
          disabled={busy}
          onClick={() => onCancel()}
          size="sm"
          variant="outline"
        >
          Cancel
        </Button>
      );
    }
    case "ready": {
      return (
        <Button
          disabled={busy}
          onClick={() => onStart()}
          size="sm"
          variant="outline"
        >
          Find again
        </Button>
      );
    }
    case "applying": {
      return (
        <Button disabled size="sm" variant="outline">
          Applying…
        </Button>
      );
    }
    default: {
      return (
        <Button disabled={busy} onClick={() => onStart()} size="sm">
          <Sparkles aria-hidden="true" />
          Find changes
        </Button>
      );
    }
  }
};

const TidyStatus = ({
  applying,
  onApply,
  state,
}: {
  applying: boolean;
  onApply: (ids: string[]) => void;
  state: TidyState;
}) => {
  switch (state.status) {
    case "running": {
      return <Running startedAt={state.startedAt} />;
    }
    case "ready": {
      return <Review applying={applying} onApply={onApply} state={state} />;
    }
    case "applying": {
      return (
        <p className="text-muted-foreground mt-6 text-sm" role="status">
          Applying {state.done.length} of {plural(state.proposals.length)}…
        </p>
      );
    }
    case "failed": {
      return (
        <Alert className="mt-4">
          <AlertDescription className="text-foreground">
            Couldn’t finish looking for changes.
            {state.retry
              ? " Try again."
              : " memsys can’t reach its model right now."}
          </AlertDescription>
        </Alert>
      );
    }
    default: {
      return state.last ? (
        <Applied applied={state.last.applied} skipped={state.last.skipped} />
      ) : null;
    }
  }
};

export const TidyView = () => {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryFn: ({ signal }) =>
      parseResponse(api.tidy.$get(undefined, { init: { signal } })),
    queryKey: TIDY,
    refetchInterval: (current) =>
      current.state.data?.status === "running" ||
      current.state.data?.status === "applying"
        ? POLL_MS
        : false,
  });
  const show = (state: TidyState) => queryClient.setQueryData(TIDY, state);
  const start = useMutation({
    mutationFn: () => parseResponse(api.tidy.$post({ json: {} })),
    onSuccess: show,
  });
  const cancel = useMutation({
    mutationFn: () => parseResponse(api.tidy.$delete()),
    onSuccess: show,
  });
  const apply = useMutation({
    mutationFn: (proposals: string[]) =>
      parseResponse(api.tidy.apply.$post({ json: { proposals } })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: TIDY });
      for (const key of ["fragments", "activity", "sources"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onSuccess: show,
  });

  const error = query.error ?? start.error ?? cancel.error ?? apply.error;
  if (isExpired(error)) {
    return <SessionExpired />;
  }

  const state = query.data;
  const busy = start.isPending || cancel.isPending || apply.isPending;

  return (
    <section aria-label="Tidy up">
      <Card>
        <CardHeader>
          <CardTitle>Tidy up</CardTitle>
          <CardDescription>
            Find duplicates, contradictions, and outdated memories. You approve
            each change before it is saved.
          </CardDescription>
          <CardAction>
            {state ? (
              <TidyAction
                busy={busy}
                onCancel={() => cancel.mutate()}
                onStart={() => start.mutate()}
                state={state}
              />
            ) : null}
          </CardAction>
        </CardHeader>
      </Card>

      {error && !query.isPending ? (
        <Alert className="mt-4">
          <AlertDescription className="text-foreground">
            {failure(error).problem.error ?? "Something went wrong. Try again."}
          </AlertDescription>
        </Alert>
      ) : null}

      {query.isPending ? (
        <div className="mt-6 space-y-2" role="status">
          <span className="sr-only">Loading</span>
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : null}

      {state ? (
        <TidyStatus
          applying={apply.isPending}
          onApply={(ids) => apply.mutate(ids)}
          state={state}
        />
      ) : null}
    </section>
  );
};
