import { createBrowserRouter, Navigate } from "react-router";

import { ActivityView } from "@/pages/activity";
import { ConsentView } from "@/pages/consent";
import { ForgottenView } from "@/pages/forgotten";
import { JoinView } from "@/pages/join";
import { LoginView } from "@/pages/login";
import { FragmentsView } from "@/pages/memories";
import { AccountView } from "@/pages/settings/account";
import { AgentsView } from "@/pages/settings/agents";
import { DataView } from "@/pages/settings/data";
import { FeaturesView } from "@/pages/settings/features";
import { ApiKeysView } from "@/pages/settings/mcp";
import { HistoryDialog } from "@/widgets/memory-history";

import { App } from "./layouts/app-layout";
import { RouteMeta } from "./layouts/route-meta";
import { SettingsView } from "./layouts/settings-layout";

export const router = createBrowserRouter([
  {
    children: [
      {
        element: <LoginView />,
        handle: { meta: { title: "Sign in" } },
        path: "/login",
      },
      {
        element: <JoinView />,
        handle: { meta: { title: "Join" } },
        path: "/join",
      },
      {
        element: <JoinView />,
        handle: { meta: { title: "Join" } },
        path: "/join/:code",
      },
      {
        element: <ConsentView />,
        handle: { meta: { title: "Connect app" } },
        path: "/consent",
      },
      {
        children: [
          { element: <Navigate replace to="activity" />, index: true },
          {
            children: [{ element: <HistoryDialog />, path: ":ref" }],
            element: <ActivityView />,
            handle: { meta: { title: "Activity" } },
            path: "activity",
          },
          {
            children: [{ element: <HistoryDialog />, path: ":ref" }],
            element: <FragmentsView />,
            handle: { meta: { title: "Memories" } },
            path: "memories",
          },
          {
            children: [{ element: <HistoryDialog />, path: ":ref" }],
            element: <ForgottenView />,
            handle: { meta: { title: "Forgotten memories" } },
            path: "forgotten",
          },
          {
            children: [
              { element: <Navigate replace to="mcp" />, index: true },
              {
                element: <ApiKeysView />,
                handle: { meta: { title: "MCP" } },
                path: "mcp",
              },
              {
                element: <AgentsView />,
                handle: { meta: { title: "Agents" } },
                path: "agents",
              },
              {
                element: <FeaturesView />,
                handle: { meta: { title: "Features" } },
                path: "features",
              },
              {
                element: <Navigate replace to="/settings/features" />,
                path: "plugins",
              },
              {
                element: <DataView />,
                handle: { meta: { title: "Data" } },
                path: "data",
              },
              {
                element: <AccountView />,
                handle: { meta: { title: "Account" } },
                path: "account",
              },
            ],
            element: <SettingsView />,
            handle: { meta: { title: "Settings" } },
            path: "settings",
          },
          { element: <Navigate replace to="/" />, path: "*" },
        ],
        element: <App />,
      },
    ],
    element: <RouteMeta />,
  },
]);
