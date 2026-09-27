import { cn } from "cn";
import { Activity, Archive, Layers, Library, Settings } from "lucide-react";
import { Navigate, NavLink, Outlet } from "react-router";

import { authClient } from "@/shared/api";
import { buttonVariants } from "@/shared/ui/button";

const current =
  "text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground";
const navClass = cn(
  buttonVariants({ size: "icon", variant: "ghost" }),
  current
);
// The two main views keep their names beside the icon; on a narrow screen
// only the icon fits.
const viewClass = cn(
  buttonVariants({ variant: "ghost" }),
  current,
  "max-sm:w-8 max-sm:px-0"
);

const VIEWS = [
  { icon: Activity, label: "Activity", to: "/activity" },
  { icon: Library, label: "Memories", to: "/memories" },
];

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
        <div className="mx-auto flex h-(--header-height) max-w-3xl items-center justify-between gap-4 px-5 sm:px-8">
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
            {VIEWS.map(({ icon: Icon, label, to }) => (
              <NavLink className={viewClass} key={to} title={label} to={to}>
                <Icon aria-hidden="true" />
                <span className="max-sm:sr-only">{label}</span>
              </NavLink>
            ))}
            <span aria-hidden="true" className="bg-border mx-1 h-5 w-px" />
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
