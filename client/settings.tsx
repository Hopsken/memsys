import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authClient } from "@/lib/auth";

const TABS = [
  { label: "MCP", to: "mcp" },
  { label: "Plugins", to: "plugins" },
  { label: "Data", to: "data" },
  { label: "Account", to: "account" },
];

const tabClass =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 aria-[current=page]:border-foreground aria-[current=page]:text-foreground -mb-px rounded-t-md border-b-2 border-transparent px-3 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3";

// Each tab is a route, so links, reloads, and Back keep the open tab.
export const SettingsView = () => (
  <>
    <nav aria-label="Settings" className="mb-8 flex gap-1 border-b">
      {TABS.map((tab) => (
        <NavLink className={tabClass} key={tab.to} to={tab.to}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
    <Outlet />
  </>
);

export const AccountView = () => {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <section aria-label="Account">
      <Card className="flex-row items-center justify-between gap-4 px-4">
        <p className="min-w-0 truncate text-base font-medium">
          {session.data?.user.email}
        </p>
        <Button
          onClick={async () => {
            await authClient.signOut();
            queryClient.clear();
            await navigate("/login", { replace: true });
          }}
          size="sm"
          variant="outline"
        >
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </Card>
    </section>
  );
};
