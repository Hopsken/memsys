import { cn } from "cn";
import { Archive, Layers, Settings } from "lucide-react";
import { Navigate, NavLink, Outlet } from "react-router";

import { authClient } from "@/shared/api";
import { buttonVariants } from "@/shared/ui/button";
import { MemoryHistoryDialog } from "@/widgets/memory-history";
import { RecallPreview } from "@/widgets/recall-preview";

const current =
  "text-muted-foreground aria-[current=page]:bg-foreground/8 aria-[current=page]:text-foreground";
const navClass = cn(
  buttonVariants({ size: "icon", variant: "ghost" }),
  current
);
const viewClass = cn(buttonVariants({ variant: "ghost" }), current);

export const App = () => {
  const session = authClient.useSession();

  if (session.isPending) {
    return null;
  }
  if (!session.data) {
    return <Navigate replace to="/login" />;
  }

  return (
    <>
      <header className="bg-background/85 sticky top-0 z-10 backdrop-blur">
        <div className="mx-auto flex h-(--header-height) max-w-3xl items-center gap-4 px-5 sm:gap-6 sm:px-8">
          {/* On a phone the logo keeps only its mark, so both views keep
          their names. */}
          <h1>
            <NavLink
              className="focus-visible:ring-ring/50 flex items-center gap-2 rounded-md text-xl font-semibold tracking-tight outline-none focus-visible:ring-3"
              end
              to="/"
            >
              <Layers aria-hidden="true" className="size-6" />
              <span className="max-sm:sr-only">memsys</span>
            </NavLink>
          </h1>
          <nav aria-label="Views" className="flex items-center gap-1">
            <NavLink className={viewClass} to="/activity">
              Activity
            </NavLink>
            <NavLink className={viewClass} to="/memories">
              Memories
            </NavLink>
          </nav>
          <nav className="ml-auto flex items-center gap-1">
            <RecallPreview
              className={navClass}
              history={(ref, onClose) => (
                <MemoryHistoryDialog memoryRef={ref} onClose={onClose} />
              )}
            />
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
      </header>
      <main className="mx-auto max-w-3xl px-5 pt-2 pb-10 sm:px-8 sm:pb-16">
        <Outlet />
      </main>
    </>
  );
};
