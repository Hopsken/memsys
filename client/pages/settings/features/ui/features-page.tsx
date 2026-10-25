import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { parseResponse } from "hono/client";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { SETTINGS, useSettings } from "@/entities/memory";
import { SessionExpired } from "@/features/auth";
import { api, failure, isExpired } from "@/shared/api";
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
import { Textarea } from "@/shared/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

const FILTER_LEVELS: { label: string; value: Settings["relevanceFilter"] }[] = [
  { label: "On", value: "low" },
  { label: "Strict", value: "medium" },
];

const INSTRUCTIONS_MAX = 500;

const same = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

// Saving only what changed lets untouched fields follow the defaults when
// they change.
const changes = (draft: Settings, saved: Settings): SettingsMergePatch => ({
  ...(!same(draft.instructions, saved.instructions) && {
    instructions: draft.instructions,
  }),
  ...(!same(draft.length, saved.length) && { length: draft.length }),
  ...(!same(draft.relevanceFilter, saved.relevanceFilter) && {
    relevanceFilter: draft.relevanceFilter,
  }),
});

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
      parseResponse(api.settings.$patch({ json: patch })),
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
  const tooLong = draft.instructions.length > INSTRUCTIONS_MAX;
  const instructionsError = tooLong
    ? `Too long. Keep it to ${INSTRUCTIONS_MAX} characters.`
    : errors["instructions"];

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(changes(draft, view.settings));
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
              Hides recalled memories that won’t help with what your AI is doing
              right now. Recall takes a moment longer and uses a little of your
              Workers AI credits.
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
              Strict also hides loose matches.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle id="instructions">Instructions</CardTitle>
            <CardDescription>
              Every connected AI gets these along with memsys’s own guidance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              aria-describedby="instructions-hint"
              aria-invalid={Boolean(instructionsError)}
              aria-labelledby="instructions"
              className="min-h-24"
              onChange={(event) =>
                setDraft({ ...draft, instructions: event.target.value })
              }
              placeholder="Before starting a task, recall #must-read."
              value={draft.instructions}
            />
            <div
              className={cn(
                "mt-2 flex items-start justify-between gap-4 text-xs",
                instructionsError ? "text-destructive" : "text-muted-foreground"
              )}
            >
              <p id="instructions-hint">
                {instructionsError ??
                  "Put the most important line first. Some apps show only part of it, and some don’t show it at all."}
              </p>
              <span className="font-mono whitespace-nowrap tabular-nums">
                {draft.instructions.length} / {INSTRUCTIONS_MAX}
              </span>
            </div>
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
                mutation.mutate({
                  instructions: null,
                  length: null,
                  relevanceFilter: null,
                })
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
              <Button disabled={busy || tooLong} size="sm" type="submit">
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
