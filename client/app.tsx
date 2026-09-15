import { ArrowDown, Layers, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { Fragment, FragmentPage } from "../worker/memory";

export const App = () => {
  const [items, setItems] = useState<Fragment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const request = useRef<AbortController | null>(null);
  const retryCursor = useRef<string | null>(null);

  const load = async (after: string | null = null) => {
    request.current?.abort();
    retryCursor.current = after;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      const query = after ? `?${new URLSearchParams({ cursor: after })}` : "";
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

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <Layers aria-hidden="true" className="size-7" />
          memsys
        </h1>
        <Button
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
          Refresh
        </Button>
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

      <section aria-label="Fragments" aria-busy={loading}>
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
            <Layers
              aria-hidden="true"
              className="text-muted-foreground mx-auto mb-4 size-6"
            />
            <h2 className="font-medium">No fragments yet</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Save a memory through your connected agent to see it here.
            </p>
          </div>
        ) : null}
        <ul className="space-y-4">
          {items.map((item) => (
            <li
              className="rounded-lg border bg-white p-5 sm:p-6"
              key={item.ref}
            >
              <div className="text-muted-foreground mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
                <span className="font-mono">{item.ref}</span>
                <time
                  dateTime={item.updatedAt}
                  title={`Updated ${new Date(item.updatedAt).toLocaleString()}`}
                >
                  {new Date(item.updatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
              <p className="text-sm leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap">
                {item.fragment}
              </p>
            </li>
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
