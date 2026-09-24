import { Puzzle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { SessionExpired } from "@/components/session-expired";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { request, SessionExpiredError, sendJson } from "@/lib/api";
import { cn } from "@/lib/utils";

import type { Json, PluginView } from "../contract/plugin";
import { hasFields, SchemaForm } from "./schema-form";
import type { FieldErrors } from "./schema-form";

interface Draft {
  enabled: boolean;
  config: Json;
}

interface Problem {
  error: string;
  issues?: { path: string[]; message: string }[];
}

const STATUS = {
  custom: { className: "bg-primary text-primary-foreground", label: "Custom" },
  default: {
    className: "bg-secondary text-muted-foreground",
    label: "Default",
  },
  invalid: {
    className: "border border-amber-300 bg-amber-50 text-amber-900",
    label: "Invalid — using defaults",
  },
} satisfies Record<PluginView["status"], { className: string; label: string }>;

const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

const PluginCard = ({
  index,
  onExpired,
  onReload,
  onSaved,
  view,
}: {
  index: number;
  onExpired: () => void;
  onReload: () => void;
  onSaved: (view: PluginView) => void;
  view: PluginView;
}) => {
  const saved = { config: view.config, enabled: view.enabled };
  const [draft, setDraft] = useState<Draft>(saved);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<{
    text: string;
    conflict: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft({ config: view.config, enabled: view.enabled });
    setErrors({});
    setProblem(null);
  }, [view]);

  const dirty = !same(draft, saved);

  const submit = async (send: () => Promise<Response>) => {
    setBusy(true);
    setProblem(null);
    try {
      const response = await send();
      if (response.ok) {
        const next: PluginView = await response.json();
        onSaved(next);
        return;
      }
      const body: Problem = await response.json();
      setErrors(
        Object.fromEntries(
          (body.issues ?? []).map((issue) => [
            issue.path.join("."),
            issue.message,
          ])
        )
      );
      if (!body.issues) {
        setProblem({ conflict: response.status === 409, text: body.error });
      }
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        onExpired();
        return;
      }
      setProblem({
        conflict: false,
        text: "Could not save. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const status = STATUS[view.status];
  const id = `plugin-${view.name}`;

  return (
    <li
      aria-labelledby={`${id}-title`}
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both rounded-lg border bg-white motion-safe:duration-500"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <header className="flex items-start justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium" id={`${id}-title`}>
              {view.title}
            </h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                status.className
              )}
            >
              {status.label}
            </span>
          </div>
          <p className="text-muted-foreground font-mono text-xs">{view.name}</p>
          <p className="text-muted-foreground text-sm leading-6">
            {view.description}
          </p>
          {view.tools.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              Adds{" "}
              {view.tools.map((tool) => (
                <code
                  className="bg-secondary text-foreground mr-1 rounded px-1.5 py-0.5"
                  key={tool}
                >
                  {tool}
                </code>
              ))}
              · agents see tool changes after reconnecting
            </p>
          ) : null}
        </div>
        <Switch
          aria-label={`Enable ${view.title}`}
          checked={draft.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
        />
      </header>

      {hasFields(view.schema) ? (
        <div
          className={cn(
            "border-t px-5 py-5 transition-opacity sm:px-6",
            draft.enabled ? "" : "opacity-55"
          )}
        >
          <SchemaForm
            defaults={view.defaults.config}
            disabled={busy}
            errors={errors}
            idPrefix={id}
            onChange={(config) => setDraft({ ...draft, config })}
            schema={view.schema}
            value={draft.config}
          />
        </div>
      ) : null}

      {problem ? (
        <div
          className="mx-5 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:mx-6"
          role="alert"
        >
          <span>{problem.text}</span>
          {problem.conflict ? (
            <Button onClick={onReload} size="sm" variant="outline">
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}

      <footer className="bg-secondary/50 flex items-center justify-between gap-3 rounded-b-lg border-t px-5 py-3 sm:px-6">
        {view.status === "default" ? (
          <span className="text-muted-foreground text-xs">Using defaults</span>
        ) : (
          <Button
            disabled={busy}
            onClick={() => {
              void submit(() =>
                request(`/api/plugins/${view.name}`, { method: "DELETE" })
              );
            }}
            size="sm"
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" />
            Reset to defaults
          </Button>
        )}
        <div className="flex items-center gap-3">
          {dirty ? (
            <span aria-live="polite" className="text-muted-foreground text-xs">
              Unsaved changes
            </span>
          ) : null}
          {dirty ? (
            <Button
              disabled={busy}
              onClick={() => setDraft(saved)}
              size="sm"
              variant="outline"
            >
              Discard
            </Button>
          ) : null}
          <Button
            disabled={busy || !dirty}
            onClick={() => {
              void submit(() =>
                sendJson(`/api/plugins/${view.name}`, "PUT", {
                  ...draft,
                  updatedAt: view.updatedAt,
                })
              );
            }}
            size="sm"
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </footer>
    </li>
  );
};

export const PluginsView = () => {
  const [views, setViews] = useState<PluginView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);

  const load = async () => {
    setFailed(false);
    try {
      const response = await request("/api/plugins");
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const next: PluginView[] = await response.json();
      setViews(next);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        setExpired(true);
      } else {
        setFailed(true);
      }
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (expired) {
    return <SessionExpired what="plugins" />;
  }

  return (
    <section aria-busy={views === null} aria-label="Plugins">
      <p className="text-muted-foreground mb-6 text-sm leading-6">
        Plugins tune how this memory behaves. Changes apply to the next request.
        Agents cannot change these settings through MCP.
      </p>
      {failed ? (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4"
          role="alert"
        >
          <p className="text-sm">Could not load plugins.</p>
          <Button
            onClick={() => {
              void load();
            }}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}
      {views === null && !failed ? (
        <div className="space-y-4" role="status">
          <span className="sr-only">Loading plugins</span>
          {[1, 2].map((key) => (
            <div className="space-y-3 rounded-lg border bg-white p-6" key={key}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-9 w-40" />
            </div>
          ))}
        </div>
      ) : null}
      {views?.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-16 text-center">
          <Puzzle
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-4 size-6"
          />
          <h2 className="font-medium">No plugins installed</h2>
        </div>
      ) : null}
      <ul className="space-y-4">
        {views?.map((view, index) => (
          <PluginCard
            index={index}
            key={view.name}
            onExpired={() => setExpired(true)}
            onReload={() => {
              void load();
            }}
            onSaved={(next) =>
              setViews((current) =>
                (current ?? []).map((item) =>
                  item.name === next.name ? next : item
                )
              )
            }
            view={view}
          />
        ))}
      </ul>
    </section>
  );
};
