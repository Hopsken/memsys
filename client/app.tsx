import { Archive, ArrowDown, Layers, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { Fragment, FragmentPage } from "../worker/memory";
import { FragmentCard } from "./fragment-card";

type View = "active" | "archived";

export const App = () => {
  const [view, setView] = useState<View>("active");
  const [items, setItems] = useState<Fragment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const request = useRef<AbortController | null>(null);
  const retryCursor = useRef<string | null>(null);

  const load = async (after: string | null = null, target: View = view) => {
    request.current?.abort();
    retryCursor.current = after;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      const params = new URLSearchParams();
      if (target === "archived") {
        params.set("archived", "1");
      }
      if (after) {
        params.set("cursor", after);
      }
      const query = params.size > 0 ? `?${params}` : "";
      const response = await fetch(`/api/fragments${query}`, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      if (
        response.type === "opaqueredirect" ||
        response.status === 401 ||
        response.status === 403
      ) {
        setItems([]);
        setCursor(null);
        setExpired(true);
        return;
      }
      if (!response.ok) {
        throw new Error("Could not load memory. Please try again.");
      }
      const page: FragmentPage = await response.json();
      setItems((previous) =>
        after
          ? [
              ...previous.filter(
                (item) => !page.fragments.some((next) => next.ref === item.ref)
              ),
              ...page.fragments,
            ]
          : page.fragments
      );
      setCursor(page.nextCursor);
    } catch {
      if (!controller.signal.aborted) {
        setError("Could not load memory. Check your connection and try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, []);

  const show = (target: View) => {
    if (target !== view) {
      setView(target);
      setItems([]);
      setCursor(null);
      void load(null, target);
    }
  };
  const archived = view === "archived";

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <Layers aria-hidden="true" className="size-7" />
          memsys
        </h1>
        <div className="flex items-center gap-2">
          <div
            aria-label="View"
            className="bg-secondary flex flex-1 rounded-md p-0.5 sm:flex-none"
            role="tablist"
          >
            {(
              [
                ["active", "Fragments", Layers],
                ["archived", "Archived", Archive],
              ] as const
            ).map(([target, label, Icon]) => (
              <Button
                aria-selected={view === target}
                className={`h-11 flex-1 sm:h-8 sm:flex-none ${view === target ? "shadow-xs" : ""}`}
                key={target}
                onClick={() => show(target)}
                role="tab"
                size="sm"
                variant={view === target ? "outline" : "ghost"}
              >
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
          <Button
            className="size-11 sm:h-9 sm:w-auto"
            disabled={loading}
            onClick={() => {
              void load();
            }}
            variant="outline"
          >
            <RefreshCw
              aria-hidden="true"
              className={loading ? "motion-safe:animate-spin" : ""}
            />
            <span className="sr-only sm:not-sr-only">Refresh</span>
          </Button>
        </div>
      </header>

      {expired ? (
        <section
          className="rounded-lg border bg-white p-8 text-center"
          role="alert"
        >
          <h2 className="font-medium">Your session has expired</h2>
          <p className="text-muted-foreground mt-2 mb-5 text-sm">
            Sign in again to view your memory.
          </p>
          <Button onClick={() => window.location.reload()}>
            Sign in again
          </Button>
        </section>
      ) : null}

      {error ? (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4"
          role="alert"
        >
          <p className="text-sm">{error}</p>
          <Button
            onClick={() => {
              void load(retryCursor.current);
            }}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}

      <section
        aria-label={archived ? "Archived fragments" : "Fragments"}
        aria-busy={loading}
      >
        {loading && items.length === 0 ? (
          <div className="space-y-4" role="status">
            <span className="sr-only">Loading memory</span>
            {[1, 2, 3].map((key) => (
              <div
                className="space-y-3 rounded-lg border bg-white p-6"
                key={key}
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : null}
        {!loading && !error && !expired && items.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-16 text-center">
            {archived ? (
              <Archive
                aria-hidden="true"
                className="text-muted-foreground mx-auto mb-4 size-6"
              />
            ) : (
              <Layers
                aria-hidden="true"
                className="text-muted-foreground mx-auto mb-4 size-6"
              />
            )}
            <h2 className="font-medium">
              {archived ? "Nothing archived" : "No fragments yet"}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {archived
                ? "Forgotten fragments are kept here and can be restored."
                : "Save a memory through your connected agent to see it here."}
            </p>
          </div>
        ) : null}
        <ul className="space-y-4">
          {items.map((item) => (
            <FragmentCard
              archived={archived}
              item={item}
              key={item.ref}
              onChange={() => {
                void load();
              }}
            />
          ))}
        </ul>
      </section>
      {items.length > 0 ? (
        <footer className="mt-6 flex flex-col items-center gap-4">
          <p aria-live="polite" className="text-muted-foreground text-xs">
            {loading
              ? "Loading memory…"
              : `${items.length} ${items.length === 1 ? "fragment" : "fragments"} shown${cursor ? "" : " · All caught up"}`}
          </p>
          {cursor ? (
            <Button
              disabled={loading}
              onClick={() => {
                void load(cursor);
              }}
              variant="outline"
            >
              <ArrowDown aria-hidden="true" />
              Load more
            </Button>
          ) : null}
        </footer>
      ) : null}
    </main>
  );
};
