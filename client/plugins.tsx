import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { cn } from "cn";
import { Puzzle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { SessionExpired } from "@/components/session-expired";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, failure, isExpired } from "@/lib/api";

import type { Json, PluginView } from "../contract/plugin";
import { hasFields, SchemaForm } from "./schema-form";
import type { FieldErrors } from "./schema-form";

interface Draft {
  enabled: boolean;
  config: Json;
}

type Change = { type: "reset" } | { type: "save"; draft: Draft };

const PLUGINS = ["plugins"];

const STATUS = {
  custom: { className: "", label: "Custom" },
  default: null,
  invalid: {
    className: "bg-amber-50 text-amber-900 ring-1 ring-amber-300",
    label: "Invalid — using defaults",
  },
} satisfies Record<
  PluginView["status"],
  { className: string; label: string } | null
>;

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

// 422 issues attach to fields; anything else is one message for the card.
const describe = (error: Error) => {
  const { problem, status } = failure(error);
  const fields: FieldErrors = Object.fromEntries(
    (problem.issues ?? []).map((issue) => [issue.path.join("."), issue.message])
  );
  return {
    conflict: status === 409,
    fields,
    text: problem.issues ? null : (problem.error ?? "Could not save."),
  };
};

const PluginCard = ({ index, view }: { index: number; view: PluginView }) => {
  const queryClient = useQueryClient();
  const saved = { config: view.config, enabled: view.enabled };
  const [draft, setDraft] = useState<Draft>(saved);
  const mutation = useMutation({
    mutationFn: (change: Change) =>
      (change.type === "reset"
        ? api.delete(`/api/plugins/${view.name}`)
        : api.put(`/api/plugins/${view.name}`, {
            json: { ...change.draft, updatedAt: view.updatedAt },
          })
      ).json<PluginView>(),
    mutationKey: [...PLUGINS, view.name],
    onSuccess: (next) => {
      queryClient.setQueryData<PluginView[]>(PLUGINS, (current) =>
        current?.map((item) => (item.name === next.name ? next : item))
      );
    },
  });
  const { reset } = mutation;

  useEffect(() => {
    setDraft({ config: view.config, enabled: view.enabled });
    reset();
  }, [view, reset]);

  const dirty = !same(draft, saved);
  const busy = mutation.isPending;
  const problem = mutation.error ? describe(mutation.error) : null;
  const status = STATUS[view.status];
  const id = `plugin-${view.name}`;

  return (
    <li
      aria-labelledby={`${id}-title`}
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-500"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <Card className="gap-0 py-0">
        <CardHeader className="py-5">
          <CardTitle
            className="flex flex-wrap items-center gap-2"
            id={`${id}-title`}
          >
            {view.title}
            {status ? (
              <Badge className={status.className} variant="secondary">
                {status.label}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>{view.description}</CardDescription>
          <CardAction>
            <Switch
              aria-label={`Enable ${view.title}`}
              checked={draft.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </CardAction>
        </CardHeader>

        {hasFields(view.schema) ? (
          <CardContent
            className={cn(
              "border-t py-4 transition-opacity",
              draft.enabled ? "" : "opacity-55"
            )}
          >
            <SchemaForm
              defaults={view.defaults.config}
              disabled={busy}
              errors={problem?.fields ?? {}}
              idPrefix={id}
              onChange={(config) => setDraft({ ...draft, config })}
              schema={view.schema}
              value={draft.config}
            />
          </CardContent>
        ) : null}

        {problem?.text ? (
          <CardContent className="pb-4">
            <Alert className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 text-amber-950 ring-amber-300">
              <AlertDescription className="text-amber-950">
                {problem.text}
              </AlertDescription>
              {problem.conflict ? (
                <Button
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: PLUGINS });
                  }}
                  size="sm"
                  variant="outline"
                >
                  Reload
                </Button>
              ) : null}
            </Alert>
          </CardContent>
        ) : null}

        {dirty || view.status !== "default" ? (
          <CardFooter className="bg-muted/50 justify-between gap-3 border-t py-3">
            {view.status === "default" ? null : (
              <Button
                disabled={busy}
                onClick={() => mutation.mutate({ type: "reset" })}
                size="sm"
                variant="ghost"
              >
                <RotateCcw aria-hidden="true" />
                Reset to defaults
              </Button>
            )}
            {dirty ? (
              <div className="ml-auto flex items-center gap-2">
                <Button
                  disabled={busy}
                  onClick={() => setDraft(saved)}
                  size="sm"
                  variant="outline"
                >
                  Discard
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => mutation.mutate({ draft, type: "save" })}
                  size="sm"
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </li>
  );
};

export const PluginsView = () => {
  const query = useQuery({
    queryFn: ({ signal }) =>
      api.get("/api/plugins", { signal }).json<PluginView[]>(),
    queryKey: PLUGINS,
  });
  const mutationErrors = useMutationState({
    filters: { mutationKey: PLUGINS, status: "error" },
    select: (mutation) => mutation.state.error,
  });

  if ([query.error, ...mutationErrors].some(isExpired)) {
    return <SessionExpired />;
  }

  return (
    <section aria-busy={query.isFetching} aria-label="Plugins">
      {query.isError ? (
        <Alert className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <AlertDescription className="text-foreground">
            Could not load plugins.
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
        <div className="space-y-4" role="status">
          <span className="sr-only">Loading plugins</span>
          {[1, 2].map((key) => (
            <Card className="gap-3 p-6" key={key}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-8 w-40" />
            </Card>
          ))}
        </div>
      ) : null}
      {query.data?.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-16 text-center">
          <Puzzle
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-4 size-6"
          />
          <h2 className="font-medium">No plugins installed</h2>
        </div>
      ) : null}
      <ul className="space-y-4">
        {query.data?.map((view, index) => (
          <PluginCard index={index} key={view.name} view={view} />
        ))}
      </ul>
    </section>
  );
};
