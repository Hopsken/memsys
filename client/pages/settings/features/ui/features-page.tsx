import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { parseResponse } from "hono/client";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { SETTINGS, useSettings } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { failure, isExpired, rpc } from "@/shared/api";
import type { Settings, SettingsMergePatch, SettingsView } from "@/shared/api";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

const FILTER_LEVELS: { label: string; value: Settings["relevanceFilter"] }[] = [
  { label: "Off", value: "off" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Max", value: "max" },
];

const same = (a: Settings, b: Settings) =>
  JSON.stringify(a) === JSON.stringify(b);

const describe = (error: Error) => {
  const { problem } = failure(error);
  return {
    fields: Object.fromEntries(
      (problem.issues ?? []).map((issue) => [
        issue.path.join("."),
        issue.message,
      ])
    ),
    text: problem.issues
      ? null
      : (problem.error ?? "Couldn’t save. Try again."),
  };
};

const Field = ({
  children,
  error,
  hint,
  id,
  label,
}: {
  children: ReactNode;
  error: string | undefined;
  hint: string;
  id: string;
  label: string;
}) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <p
        className={cn(
          "mt-0.5 text-xs",
          error ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {error ?? hint}
      </p>
    </div>
    {children}
  </div>
);

const LengthInput = ({
  id,
  invalid,
  onChange,
  value,
}: {
  id: string;
  invalid: boolean;
  onChange: (value: number) => void;
  value: number;
}) => (
  <Input
    aria-invalid={invalid}
    className="w-24 text-right font-mono tabular-nums"
    id={id}
    inputMode="numeric"
    max={1000}
    min={1}
    onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
    step={1}
    type="number"
    value={Number.isNaN(value) ? "" : value}
  />
);

const FeaturesForm = ({ view }: { view: SettingsView }) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(view.settings);
  const mutation = useMutation({
    mutationFn: (patch: SettingsMergePatch) =>
      parseResponse(rpc.settings.$patch({ json: patch })),
    onSuccess: (next) => queryClient.setQueryData(SETTINGS, next),
  });
  const { reset } = mutation;

  useEffect(() => {
    setDraft(view.settings);
    reset();
  }, [view, reset]);

  if (mutation.error && isExpired(mutation.error)) {
    return <SessionExpired />;
  }

  const dirty = !same(draft, view.settings);
  const custom = !same(view.settings, view.defaults);
  const busy = mutation.isPending;
  const problem = mutation.error ? describe(mutation.error) : null;
  const errors = problem?.fields ?? {};

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(draft);
      }}
    >
      <fieldset className="space-y-4" disabled={busy}>
        <Card>
          <CardHeader>
            <CardTitle>Short memories</CardTitle>
            <CardDescription>
              Keeps each memory to one short idea. Counted in characters.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <Field
              error={errors["length.warn"]}
              hint="Longer memories are saved, with a nudge to split them."
              id="length-warn"
              label="Warn above"
            >
              <LengthInput
                id="length-warn"
                invalid={Boolean(errors["length.warn"])}
                onChange={(warn) =>
                  setDraft({ ...draft, length: { ...draft.length, warn } })
                }
                value={draft.length.warn}
              />
            </Field>
            <Field
              error={errors["length.refuse"]}
              hint="Longer memories are refused."
              id="length-refuse"
              label="Refuse above"
            >
              <LengthInput
                id="length-refuse"
                invalid={Boolean(errors["length.refuse"])}
                onChange={(refuse) =>
                  setDraft({ ...draft, length: { ...draft.length, refuse } })
                }
                value={draft.length.refuse}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle id="relevance-filter">Relevance filter</CardTitle>
            <CardDescription>
              A small AI model checks each recalled memory against what your AI
              is doing and hides the ones that don’t help. Adds about a second
              per recall and uses Workers AI credits. If the check fails, the
              recall fails too.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToggleGroup
              aria-labelledby="relevance-filter"
              onValueChange={([next]) => {
                const level = FILTER_LEVELS.find((item) => item.value === next);
                if (level) {
                  setDraft({ ...draft, relevanceFilter: level.value });
                }
              }}
              size="sm"
              spacing={0}
              value={[draft.relevanceFilter]}
              variant="outline"
            >
              {FILTER_LEVELS.map(({ label, value }) => (
                <ToggleGroupItem
                  className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  key={value}
                  value={value}
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-muted-foreground mt-2 text-xs">
              Low hides only clear misses; Max keeps only strong matches.
            </p>
          </CardContent>
        </Card>
      </fieldset>

      {problem?.text ? (
        <Alert className="bg-amber-50 text-amber-950 ring-amber-300">
          <AlertDescription className="text-amber-950">
            {problem.text}
          </AlertDescription>
        </Alert>
      ) : null}

      {dirty || custom ? (
        <div className="flex items-center gap-2">
          {custom && !dirty ? (
            <Button
              disabled={busy}
              onClick={() =>
                mutation.mutate({ length: null, relevanceFilter: null })
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" />
              Reset to defaults
            </Button>
          ) : null}
          {dirty ? (
            <div className="ml-auto flex items-center gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  setDraft(view.settings);
                  reset();
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                Discard
              </Button>
              <Button disabled={busy} size="sm" type="submit">
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
};

export const FeaturesView = () => {
  const query = useSettings();

  if (isExpired(query.error)) {
    return <SessionExpired />;
  }

  return (
    <section aria-busy={query.isFetching} aria-label="Features">
      {query.isError ? (
        <Alert className="flex flex-wrap items-center justify-between gap-3">
          <AlertDescription className="text-foreground">
            Couldn’t load settings.
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
          <span className="sr-only">Loading settings</span>
          {[1, 2].map((key) => (
            <Card className="gap-3 p-6" key={key}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-8 w-40" />
            </Card>
          ))}
        </div>
      ) : null}
      {query.data ? <FeaturesForm view={query.data} /> : null}
    </section>
  );
};
