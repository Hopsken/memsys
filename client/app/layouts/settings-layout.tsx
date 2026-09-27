import { NavLink, Outlet } from "react-router";

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
