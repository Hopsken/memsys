import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { cn } from "cn";
import { ChevronDown, Puzzle, RotateCcw } from "lucide-react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, failure, isExpired } from "@/lib/api";

import type { Json, PluginView } from "../contract/plugin";
import { hasFields, SchemaForm, summarize } from "./schema-form";
import type { FieldErrors } from "./schema-form";
import { PanelHeader } from "./settings";

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

const SaveProblem = ({
  conflict,
  text,
}: {
  conflict: boolean;
  text: string;
}) => {
  const queryClient = useQueryClient();
  return (
    <CardContent className="pb-4">
      <Alert className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 text-amber-950 ring-amber-300">
        <AlertDescription className="text-amber-950">{text}</AlertDescription>
        {conflict ? (
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
  );
};

interface ActionsProps {
  busy: boolean;
  dirty: boolean;
  onDiscard: () => void;
  onReset: (() => void) | null;
  onSave: () => void;
}

const Actions = ({ busy, dirty, onDiscard, onReset, onSave }: ActionsProps) => (
  <>
    {onReset ? (
      <Button disabled={busy} onClick={onReset} size="sm" variant="ghost">
        <RotateCcw aria-hidden="true" />
        Reset to defaults
      </Button>
    ) : null}
    {dirty ? (
      <div className="ml-auto flex items-center gap-2">
        <Button disabled={busy} onClick={onDiscard} size="sm" variant="outline">
          Discard
        </Button>
        <Button disabled={busy} onClick={onSave} size="sm">
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    ) : null}
  </>
);

const PluginCard = ({ view }: { view: PluginView }) => {
  const queryClient = useQueryClient();
  const saved = { config: view.config, enabled: view.enabled };
  const [draft, setDraft] = useState<Draft>(saved);
  // Settings start closed; an invalid saved config opens them.
  const [open, setOpen] = useState(view.status === "invalid");
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
  const configurable = hasFields(view.schema);
  // Field errors stay visible until fixed.
  const expanded = open || Object.keys(problem?.fields ?? {}).length > 0;
  // Reset lives with the settings; plugins without settings show it directly.
  const footer =
    dirty || (view.status !== "default" && (expanded || !configurable));

  const actions = (
    <Actions
      busy={busy}
      dirty={dirty}
      onDiscard={() => setDraft(saved)}
      onReset={
        view.status === "default"
          ? null
          : () => mutation.mutate({ type: "reset" })
      }
      onSave={() => mutation.mutate({ draft, type: "save" })}
    />
  );

  return (
    <li aria-labelledby={`${id}-title`}>
      <Collapsible onOpenChange={setOpen} open={expanded}>
        <Card
          className={cn(
            "relative gap-0 py-0",
            configurable && "rounded-b-none"
          )}
        >
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

          {problem?.text ? (
            <SaveProblem conflict={problem.conflict} text={problem.text} />
          ) : null}

          {!configurable && footer ? (
            <CardFooter className="bg-muted/50 justify-between gap-3 border-t py-3">
              {actions}
            </CardFooter>
          ) : null}
        </Card>

        {configurable ? (
          <div className="border-foreground/10 bg-muted/60 rounded-b-xl border border-t-0">
            <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-b-xl px-4 py-2.5 text-left text-xs outline-none focus-visible:ring-[3px] data-[panel-open]:rounded-none">
              <span className="text-foreground shrink-0 font-medium">
                Settings
              </span>
              <span className="min-w-0 flex-1 truncate group-data-[panel-open]/trigger:invisible">
                {summarize(view.schema, draft.config)}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform duration-200 group-data-[panel-open]/trigger:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
              <div
                className={cn(
                  "border-foreground/10 border-t px-4 py-4 transition-opacity",
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
              </div>
            </CollapsibleContent>
            {footer ? (
              <div className="border-foreground/10 flex items-center justify-between gap-3 border-t px-3 py-2.5">
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </Collapsible>
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
      <PanelHeader title="Plugins">
        Plugins change how fragments are written and recalled. Settings here
        apply to your memory only.
      </PanelHeader>
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
          <h4 className="font-medium">No plugins installed</h4>
        </div>
      ) : null}
      <ul className="space-y-4">
        {query.data?.map((view) => (
          <PluginCard key={view.name} view={view} />
        ))}
      </ul>
    </section>
  );
};
