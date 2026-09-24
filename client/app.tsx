import { cn } from "cn";
import { Layers, SlidersHorizontal } from "lucide-react";
import { NavLink, Outlet } from "react-router";

import { buttonVariants } from "@/components/ui/button";

export const App = () => (
  <>
    <header className="bg-background/85 sticky top-0 z-10 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-6">
        <h1>
          <NavLink
            className="focus-visible:ring-ring/50 flex items-center gap-3 rounded-md text-3xl font-semibold tracking-tight outline-none focus-visible:ring-3"
            end
            to="/"
          >
            <Layers aria-hidden="true" className="size-7" />
            memsys
          </NavLink>
        </h1>
        <NavLink
          aria-label="Plugins"
          className={cn(
            buttonVariants({ size: "icon", variant: "ghost" }),
            "text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
          )}
          title="Plugins"
          to="/plugins"
        >
          <SlidersHorizontal aria-hidden="true" />
        </NavLink>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-5 pt-2 pb-10 sm:px-8 sm:pb-16">
      <Outlet />
    </main>
  </>
);
