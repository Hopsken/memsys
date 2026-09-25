import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth";

const TABS = [
  { label: "MCP", to: "mcp" },
  { label: "Plugins", to: "plugins" },
  { label: "Data", to: "data" },
  { label: "Account", to: "account" },
];

const tabClass =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 aria-[current=page]:border-foreground aria-[current=page]:text-foreground -mb-px rounded-t-md border-b-2 border-transparent px-3 pt-1 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3";

// Every tab opens with the same title and one-line purpose.
export const PanelHeader = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <div className="mb-6 space-y-1">
    <h3 className="text-lg font-medium">{title}</h3>
    <p className="text-muted-foreground text-sm">{children}</p>
  </div>
);

// Each tab is a route, so links, reloads, and Back keep the open tab.
export const SettingsView = () => (
  <>
    <h2 className="mb-5 text-2xl font-semibold tracking-tight">Settings</h2>
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
      <PanelHeader title="Account">
        You sign in with a one-time code sent to this address.
      </PanelHeader>
      <Card>
        <CardHeader>
          <CardTitle className="truncate">{session.data?.user.email}</CardTitle>
          <CardDescription>Signed in</CardDescription>
          <CardAction>
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
          </CardAction>
        </CardHeader>
      </Card>
    </section>
  );
};
