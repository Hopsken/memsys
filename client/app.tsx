import { cn } from "cn";
import { Layers, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";

import { FragmentsView } from "./fragments";
import { PluginsView } from "./plugins";

const useRoute = () => {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return hash === "#/plugins" ? "plugins" : "fragments";
};

export const App = () => {
  const route = useRoute();
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1>
          <a
            aria-current={route === "fragments" ? "page" : undefined}
            className="focus-visible:ring-ring/50 flex items-center gap-3 rounded-md text-3xl font-semibold tracking-tight outline-none focus-visible:ring-3"
            href="#/"
          >
            <Layers aria-hidden="true" className="size-7" />
            memsys
          </a>
        </h1>
        <a
          aria-current={route === "plugins" ? "page" : undefined}
          aria-label="Plugins"
          className={cn(
            buttonVariants({ size: "icon", variant: "ghost" }),
            "text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
          )}
          href="#/plugins"
          title="Plugins"
        >
          <SlidersHorizontal aria-hidden="true" />
        </a>
      </header>
      {route === "plugins" ? <PluginsView /> : <FragmentsView />}
    </main>
  );
};
