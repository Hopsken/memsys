import { Layers } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { FragmentsView } from "./fragments";
import { PluginsView } from "./plugins";

const ROUTES = [
  { hash: "#/", label: "Fragments" },
  { hash: "#/plugins", label: "Plugins" },
] as const;

const useRoute = () => {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return hash === "#/plugins" ? "#/plugins" : "#/";
};

export const App = () => {
  const route = useRoute();
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <Layers aria-hidden="true" className="size-7" />
          memsys
        </h1>
        <nav
          aria-label="Sections"
          className="bg-secondary flex gap-1 rounded-lg p-1"
        >
          {ROUTES.map(({ hash, label }) => (
            <a
              aria-current={route === hash ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
                route === hash
                  ? "text-foreground bg-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href={hash}
              key={hash}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      {route === "#/plugins" ? <PluginsView /> : <FragmentsView />}
    </main>
  );
};
