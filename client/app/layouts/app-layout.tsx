import { cn } from "cn";
import { Archive, Layers, Settings } from "lucide-react";
import { Navigate, NavLink, Outlet, useMatches } from "react-router";

import { TagFilterBar } from "@/pages/memories";
import { authClient } from "@/shared/api";
import { buttonVariants } from "@/shared/ui/button";

const navClass = cn(
  buttonVariants({ size: "icon", variant: "ghost" }),
  "text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
);

export const App = () => {
  const session = authClient.useSession();
  // The memory list's tag filter extends the header, so it stays in view on
  // a long list.
  const onList = useMatches().some(({ id }) => id === "memories");

  if (session.isPending) {
    return null;
  }
  if (!session.data) {
    return <Navigate replace to="/login" />;
  }

  return (
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
          <nav className="flex items-center gap-1">
            <NavLink
              aria-label="Forgotten memories"
              className={navClass}
              title="Forgotten memories"
              to="/forgotten"
            >
              <Archive aria-hidden="true" />
            </NavLink>
            <NavLink
              aria-label="Settings"
              className={navClass}
              title="Settings"
              to="/settings"
            >
              <Settings aria-hidden="true" />
            </NavLink>
          </nav>
        </div>
        {onList ? <TagFilterBar /> : null}
      </header>
      <main className="mx-auto max-w-3xl px-5 pt-2 pb-10 sm:px-8 sm:pb-16">
        <Outlet />
      </main>
    </>
  );
};
